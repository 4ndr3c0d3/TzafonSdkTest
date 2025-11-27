import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { chromium, Browser, BrowserContext, Page } from 'playwright';

type Viewport = { width: number; height: number };

type RecorderEvent =
  | { type: 'click'; x: number; y: number; button?: 'left' | 'right' | 'middle' }
  | { type: 'scroll'; deltaX?: number; deltaY?: number }
  | { type: 'key'; key?: string }
  | { type: 'type'; text?: string; pressEnter?: boolean };

type RecorderSession = {
  id: string;
  browser: Browser;
  context: BrowserContext;
  page: Page;
  url: string;
  viewport: Viewport;
};

type Shot = { image: string; file?: string };

const PORT = parseInt(process.env.RECORDER_PORT || '8010', 10);
const HEADLESS = process.env.RECORDER_HEADLESS !== 'false';
const BASE_DIR = path.join(process.cwd(), 'results', 'recorder');
fs.mkdirSync(BASE_DIR, { recursive: true });

const STATIC_ROOT = path.join(process.cwd(), 'frontend', 'dist');
const INDEX_HTML = (() => {
  try {
    return fs.readFileSync(path.join(STATIC_ROOT, 'index.html'), 'utf8');
  } catch {
    return '';
  }
})();
const FALLBACK_HTML = '<!doctype html><html><body><h3>Frontend not built</h3><p>Run "cd frontend && npm install && npm run dev" or build and restart the service.</p></body></html>';

const sessions = new Map<string, RecorderSession>();

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

const setCors = (res: http.ServerResponse) => {
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-headers', 'content-type');
  res.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS');
};

const readJson = (req: http.IncomingMessage) =>
  new Promise<any>((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch (err) { reject(err); }
    });
    req.on('error', reject);
  });

const sendJson = (res: http.ServerResponse, status: number, body: any) => {
  setCors(res);
  const data = Buffer.from(JSON.stringify(body));
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': data.length });
  res.end(data);
};

const sendHtml = (res: http.ServerResponse, html: string) => {
  setCors(res);
  const data = Buffer.from(html);
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-length': data.length });
  res.end(data);
};

const sendFile = (res: http.ServerResponse, filePath: string) => {
  try {
    const data = fs.readFileSync(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const type =
      ext === '.js' ? 'application/javascript' :
      ext === '.css' ? 'text/css' :
      ext === '.svg' ? 'image/svg+xml' :
      ext === '.png' ? 'image/png' :
      ext === '.ico' ? 'image/x-icon' : 'application/octet-stream';
    setCors(res);
    res.writeHead(200, { 'content-type': type, 'content-length': data.length });
    res.end(data);
    return true;
  } catch {
    return false;
  }
};

const timestamp = (prefix = '') => {
  const now = new Date();
  const ts = now
    .toISOString()
    .replace(/[-:.TZ]/g, '')
    .slice(0, 17);
  return `${prefix}${ts}${now.getMilliseconds().toString().padStart(3, '0')}`;
};

async function safeShot(session: RecorderSession, tag: string): Promise<Shot> {
  try {
    const buf = await session.page.screenshot({ fullPage: false });
    const file = path.join(BASE_DIR, `${timestamp(`${session.id}_${tag}_`)}.png`);
    fs.writeFileSync(file, buf);
    return { image: `data:image/png;base64,${buf.toString('base64')}`, file };
  } catch {
    return { image: '', file: undefined };
  }
}

async function createSession(targetUrl: string, viewport?: Partial<Viewport>) {
  if (!targetUrl) throw new Error('Missing url');
  const vp: Viewport = {
    width: clamp(Math.floor(viewport?.width ?? 1366), 360, 2560),
    height: clamp(Math.floor(viewport?.height ?? 768), 480, 1600),
  };

  const browser = await chromium.launch({ headless: HEADLESS });
  const context = await browser.newContext({ viewport: vp });
  const page = await context.newPage();
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });

  const session: RecorderSession = { id: randomUUID(), browser, context, page, url: targetUrl, viewport: vp };
  sessions.set(session.id, session);

  const shot = await safeShot(session, 'init');
  const tzafon = [
    `// viewport ${vp.width}x${vp.height}`,
    `await computer.setViewport(${vp.width}, ${vp.height});`,
    `await computer.navigate(${JSON.stringify(targetUrl)});`,
    'await computer.wait(1);',
  ];

  return { session, image: shot.image, tzafon };
}

async function closeSession(id: string) {
  const session = sessions.get(id);
  if (!session) return false;
  sessions.delete(id);
  try { await session.context.close(); } catch {}
  try { await session.browser.close(); } catch {}
  return true;
}

async function handleEvent(session: RecorderSession, event: RecorderEvent) {
  const { page } = session;
  const tzafon: string[] = [];
  let meta = '';

  if (event.type === 'click') {
    const x = Math.max(0, Math.round(event.x));
    const y = Math.max(0, Math.round(event.y));
    const button = event.button || 'left';
    await page.mouse.click(x, y, { button });
    tzafon.push(`await computer.click(${x}, ${y});`);
    meta = `click ${button} @ (${x}, ${y})`;
  } else if (event.type === 'scroll') {
    const before = await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY }));
    const dx = Math.round(event.deltaX ?? 0);
    const dy = Math.round(event.deltaY ?? 0);
    await page.mouse.wheel(dx, dy);
    const after = await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY }));
    tzafon.push(`await computer.scroll(${after.x - before.x}, ${after.y - before.y});`);
    meta = `scroll x:${before.x}→${after.x} y:${before.y}→${after.y}`;
    const shot = await safeShot(session, 'scroll');
    return { tzafon, image: shot.image, meta, scroll: { start: before, end: after } };
  } else if (event.type === 'type') {
    const text = event.text ?? '';
    if (text) {
      await page.keyboard.type(text);
      tzafon.push(`await computer.type(${JSON.stringify(text)});`);
      meta = `typed: ${text}`;
    }
    if (event.pressEnter) {
      await page.keyboard.press('Enter');
      tzafon.push('await computer.key("Enter");');
      meta = meta ? `${meta} + Enter` : 'Enter';
    }
  } else if (event.type === 'key') {
    const key = event.key || 'Enter';
    await page.keyboard.press(key);
    tzafon.push(`await computer.key(${JSON.stringify(key)});`);
    meta = `key: ${key}`;
  } else {
    throw new Error(`Unsupported event type: ${(event as any)?.type}`);
  }

  const shot = await safeShot(session, event.type);
  return { tzafon, image: shot.image, meta };
}

async function shutdown() {
  const ids = Array.from(sessions.keys());
  await Promise.all(ids.map((id) => closeSession(id).catch(() => false)));
}

const server = http.createServer(async (req, res) => {
  try {
    if (!req.url) return sendJson(res, 404, { error: 'not found' });
    const parsed = new URL(req.url, 'http://localhost');

    if (req.method === 'OPTIONS') {
      setCors(res);
      res.writeHead(204);
      return res.end();
    }

    if (req.method === 'GET' && parsed.pathname === '/health') return sendJson(res, 200, { ok: true });

    if (req.method === 'GET' && !parsed.pathname.startsWith('/api')) {
      const candidate = path.join(STATIC_ROOT, parsed.pathname === '/' ? 'index.html' : parsed.pathname.slice(1));
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        if (sendFile(res, candidate)) return;
      }
      if (INDEX_HTML) return sendHtml(res, INDEX_HTML);
      return sendHtml(res, FALLBACK_HTML);
    }

    if (req.method === 'POST' && parsed.pathname === '/api/session') {
      const body = await readJson(req);
      const { session, image, tzafon } = await createSession(body.url, body.viewport);
      return sendJson(res, 200, { id: session.id, viewport: session.viewport, image, tzafon, info: 'session created' });
    }

    const matchEvent = parsed.pathname.match(/^\/api\/session\/([^/]+)\/event$/);
    if (req.method === 'POST' && matchEvent) {
      const session = sessions.get(matchEvent[1]);
      if (!session) return sendJson(res, 404, { error: 'unknown session' });
      const body = await readJson(req);
      const result = await handleEvent(session, body as RecorderEvent);
      return sendJson(res, 200, { ...result, info: 'ok' });
    }

    const matchClose = parsed.pathname.match(/^\/api\/session\/([^/]+)\/close$/);
    if (req.method === 'POST' && matchClose) {
      const closed = await closeSession(matchClose[1]);
      return sendJson(res, 200, { closed });
    }

    return sendJson(res, 404, { error: 'not found' });
  } catch (err: any) {
    return sendJson(res, 500, { error: String(err?.message || err) });
  }
});

server.listen(PORT, () => {
  console.log(`[recorder-service] listening on :${PORT} (headless=${HEADLESS})`);
});

['SIGINT', 'SIGTERM'].forEach((sig) => {
  process.on(sig, () => {
    shutdown()
      .catch(() => {})
      .finally(() => process.exit(0));
  });
});
