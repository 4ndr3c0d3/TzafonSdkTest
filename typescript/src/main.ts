// Gateway/orchestrator: connects the Python tzafon service and the TS browser service
import { argv } from 'node:process';

type ShotReq = { url: string; engine?: 'playwright' | 'tzafon'; tabs?: number; fullPage?: boolean };

async function postJson<T>(base: string, path: string, body: any): Promise<T> {
  const res = await fetch(new URL(path, base).toString(), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  if (!res.ok) throw new Error(`${path} failed: ${res.status}`);
  return (await res.json()) as T;
}

function parseArg(name: string, fallback?: string): string | undefined {
  const pref = `--${name}=`;
  const raw = argv.find(a => a.startsWith(pref));
  return (raw?.slice(pref.length) || fallback);
}

async function run() {
  const url = parseArg('url') || 'https://www.wikipedia.org/';
  const tabs = parseInt(parseArg('tabs', '3')!, 10) || 3;
  const engine = (parseArg('engine', 'playwright') as 'playwright' | 'tzafon');
  // Default browser service now the Python Playwright service on :8002
  const browserSvc = parseArg('browser', 'http://127.0.0.1:8002')!;
  const pythonSvc = parseArg('python', 'http://127.0.0.1:8001')!;

  console.log(`[gateway] Using browser service: ${browserSvc}`);
  console.log(`[gateway] Using python service: ${pythonSvc}`);
  console.log(`[gateway] Target: ${url} engine=${engine} tabs=${tabs}`);

  const browserReq: ShotReq = { url, engine, tabs, fullPage: true };

  const [browserResp, pythonResp] = await Promise.all([
    postJson<{ engine: string; images: string[] }>(browserSvc, '/screenshot', browserReq),
    postJson<{ engine: string; image: string }>(pythonSvc, '/screenshot', { url }),
  ]);

  console.log('[gateway] Browser service images:', browserResp.images);
  console.log('[gateway] Python service image:', pythonResp.image);
}

run().catch(err => {
  console.error('[gateway] error:', err);
  process.exitCode = 1;
});
