import http from 'node:http';
import path from 'node:path';
import { ensureDir, timestamp } from '../utils.js';
import fs from 'node:fs';

type Engine = 'tzafon' | 'playwright';

type ScreenshotRequest = {
  url: string;
  engine?: Engine;
  tabs?: number;
  fullPage?: boolean;
};

type JsonValue = any;

function readJson(req: http.IncomingMessage): Promise<JsonValue> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

function sendJson(res: http.ServerResponse, status: number, body: JsonValue) {
  const data = Buffer.from(JSON.stringify(body));
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': data.length,
  });
  res.end(data);
}

async function handleScreenshot(body: ScreenshotRequest) {
  const engine: Engine = (body.engine === 'playwright' ? 'playwright' : 'tzafon');
  const tabs = Math.max(1, Math.min(50, Math.floor(body.tabs ?? 1)));
  const fullPage = Boolean(body.fullPage);
  const targetUrl = body.url;
  if (!targetUrl) throw new Error('Missing url');

  const outDir = path.join(path.dirname(new URL(import.meta.url).pathname), '../../results/service_browser');
  ensureDir(outDir);

  if (engine === 'playwright') {
    let chromium: any;
    try { ({ chromium } = await import('playwright')); }
    catch (err) { throw new Error('Playwright not installed. npm i -D playwright'); }

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
    try {
      const tasks = Array.from({ length: tabs }, async (_, i) => {
        const page = await context.newPage();
        await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
        try { await page.waitForTimeout(1000); } catch {}
        const file = path.join(outDir, `${timestamp('play_' + i + '_')}.png`);
        await page.screenshot({ path: file, fullPage });
        await page.close();
        return file;
      });
      const images = await Promise.all(tasks);
      return { engine, images };
    } finally {
      await context.close();
      await browser.close();
    }
  }

  // tzafon path – create N computers in parallel (multi-session)
  const { default: Computer } = await import('tzafon');
  const tasks = Array.from({ length: tabs }, async (_, i) => {
    const client = new (Computer as any)();
    const computer = await client.create({ kind: 'browser' });
    await computer.navigate(targetUrl);
    try { await computer.wait(2); } catch {}
    const result = await computer.screenshot();
    const url = (result as any)?.result?.screenshot_url as string | undefined;
    let file = '';
    if (url) {
      const res = await fetch(url);
      const buf = Buffer.from(await res.arrayBuffer());
      file = path.join(outDir, `${timestamp('tza_' + i + '_')}.png`);
      fs.writeFileSync(file, buf);
    }
    await computer.close();
    return file;
  });
  const images = await Promise.all(tasks);
  return { engine, images };
}

const PORT = parseInt(process.env.BROWSER_SERVICE_PORT || '8000', 10);
const PY_CDP_BASE = process.env.PY_CDP_BASE || 'http://127.0.0.1:8002';

const server = http.createServer(async (req, res) => {
  try {
    if (!req.url) return sendJson(res, 404, { error: 'not found' });
    const { method } = req;
    const url = new URL(req.url, 'http://localhost');

    if (method === 'GET' && url.pathname === '/health') {
      return sendJson(res, 200, { ok: true });
    }

    if (method === 'POST' && url.pathname === '/screenshot') {
      const body = (await readJson(req)) as ScreenshotRequest;
      const result = await handleScreenshot(body);
      return sendJson(res, 200, result);
    }

    // Proxy CDP operations to Python CDP service
    if (method === 'POST' && url.pathname === '/cdp/create') {
      const body = await readJson(req);
      const r = await fetch(new URL('/cdp/create', PY_CDP_BASE), {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {})
      });
      const data = await r.json().catch(() => ({ ok: false }));
      return sendJson(res, r.status, data);
    }

    if (method === 'POST' && url.pathname === '/cdp/screenshot') {
      const body = await readJson(req);
      const r = await fetch(new URL('/cdp/screenshot', PY_CDP_BASE), {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {})
      });
      const data = await r.json().catch(() => ({ ok: false }));
      return sendJson(res, r.status, data);
    }

    if (method === 'POST' && url.pathname === '/cdp/close') {
      const body = await readJson(req);
      const r = await fetch(new URL('/cdp/close', PY_CDP_BASE), {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {})
      });
      const data = await r.json().catch(() => ({ ok: false }));
      return sendJson(res, r.status, data);
    }

    // Local CDP (no tzafon) proxies
    if (method === 'POST' && url.pathname === '/local-cdp/create') {
      const body = await readJson(req);
      const r = await fetch(new URL('/local-cdp/create', PY_CDP_BASE), {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {})
      });
      const data = await r.json().catch(() => ({ ok: false }));
      return sendJson(res, r.status, data);
    }

    if (method === 'POST' && url.pathname === '/local-cdp/screenshot') {
      const body = await readJson(req);
      const r = await fetch(new URL('/local-cdp/screenshot', PY_CDP_BASE), {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {})
      });
      const data = await r.json().catch(() => ({ ok: false }));
      return sendJson(res, r.status, data);
    }

    if (method === 'POST' && url.pathname === '/local-cdp/close') {
      const body = await readJson(req);
      const r = await fetch(new URL('/local-cdp/close', PY_CDP_BASE), {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {})
      });
      const data = await r.json().catch(() => ({ ok: false }));
      return sendJson(res, r.status, data);
    }

    return sendJson(res, 404, { error: 'not found' });
  } catch (err: any) {
    return sendJson(res, 500, { error: String(err?.message || err) });
  }
});

server.listen(PORT, () => {
  console.log(`[browser-service] listening on :${PORT}`);
});
