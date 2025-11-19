import http from 'node:http';
import path from 'node:path';
import { ensureDir, timestamp } from '../utils.js';

type Json = any;

type MultiTabBody = {
  url: string;
  count?: number;      // number of tabs to open
  fullPage?: boolean;  // full page screenshot
  delayMs?: number;    // extra wait before capture
};

function readJson(req: http.IncomingMessage): Promise<Json> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', c => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

function sendJson(res: http.ServerResponse, status: number, body: Json) {
  const data = Buffer.from(JSON.stringify(body));
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': data.length });
  res.end(data);
}

async function captureMultiTab(body: MultiTabBody) {
  const url = body.url;
  if (!url) throw new Error('Missing url');
  const count = Math.max(1, Math.min(50, Math.floor(body.count ?? 5)));
  const fullPage = Boolean(body.fullPage);
  const delayMs = Math.max(0, Math.floor(body.delayMs ?? 1000));

  let chromium: any;
  try { ({ chromium } = await import('playwright')); }
  catch (err) { throw new Error('Playwright not installed. Run: npm i -D playwright && npx playwright install'); }

  const outDir = path.join(path.dirname(new URL(import.meta.url).pathname), '../../results/service_multitab');
  ensureDir(outDir);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  try {
    const pages = await Promise.all(Array.from({ length: count }, async () => {
      const p = await context.newPage();
      await p.goto(url, { waitUntil: 'domcontentloaded' });
      return p;
    }));

    if (delayMs > 0) await Promise.all(pages.map(p => p.waitForTimeout(delayMs).catch(() => {})));

    const images = await Promise.all(pages.map(async (p, i) => {
      const file = path.join(outDir, `${timestamp('mt_' + i + '_')}.png`);
      await p.screenshot({ path: file, fullPage });
      return file;
    }));

    await Promise.all(pages.map(p => p.close().catch(() => {})));
    return { images };
  } finally {
    await context.close();
    await browser.close();
  }
}

const PORT = parseInt(process.env.MULTITAB_SERVICE_PORT || '8004', 10);

const server = http.createServer(async (req, res) => {
  try {
    if (!req.url) return sendJson(res, 404, { error: 'not found' });
    const { method } = req;
    const url = new URL(req.url, 'http://localhost');

    if (method === 'GET' && url.pathname === '/health') {
      return sendJson(res, 200, { ok: true });
    }

    if (method === 'POST' && url.pathname === '/screenshot') {
      const body = (await readJson(req)) as MultiTabBody;
      const result = await captureMultiTab(body);
      return sendJson(res, 200, result);
    }

    return sendJson(res, 404, { error: 'not found' });
  } catch (err: any) {
    return sendJson(res, 500, { error: String(err?.message || err) });
  }
});

server.listen(PORT, () => {
  console.log(`[multitab-service] listening on :${PORT}`);
});

