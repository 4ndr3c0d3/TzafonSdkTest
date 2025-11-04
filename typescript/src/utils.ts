import fs from 'node:fs';
import path from 'node:path';
// Node 18+ has global fetch

export function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
}

export function timestamp(prefix = '') {
  const now = new Date();
  const ts = now
    .toISOString()
    .replace(/[-:.TZ]/g, '')
    .replace(/\..+$/, '');
  return `${prefix}${ts}${now.getMilliseconds().toString().padStart(3, '0')}`;
}

function decodeImage(result: any): Buffer {
  if (result == null) return Buffer.alloc(0);
  if (Buffer.isBuffer(result)) return result as Buffer;
  if (result instanceof Uint8Array) return Buffer.from(result);
  if (typeof result === 'string') {
    const data = result.trim();
    if (data.startsWith('data:image/')) {
      const [, b64] = data.split(',', 2);
      return Buffer.from(b64, 'base64');
    }
    // assume base64 or UTF-8 fallback
    try { return Buffer.from(data, 'base64'); } catch { return Buffer.from(data, 'utf8'); }
  }
  if (typeof result === 'object') {
    for (const key of ['png', 'image', 'data']) {
      if (key in result) return decodeImage((result as any)[key]);
    }
  }
  return Buffer.alloc(0);
}

export async function saveScreenshot(computer: any, filePath: string) {
  ensureDir(path.dirname(filePath));
  let data: any = Buffer.alloc(0);
  try {
    data = await (computer as any).screenshot();
  } catch {}
  const buf = decodeImage(data);
  fs.writeFileSync(filePath, buf);
}

export async function downloadToFile(url: string, filePath: string) {
  ensureDir(path.dirname(filePath));
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download ${url}: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(filePath, buf);
}
