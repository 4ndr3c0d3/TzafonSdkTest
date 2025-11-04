import Computer from 'tzafon';
import path from 'node:path';
import { ensureDir, timestamp, downloadToFile } from './utils.js';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const URLS: [string, string][] = [
  ['wikipedia', 'https://www.wikipedia.org/'],
  ['nytimes', 'https://www.nytimes.com/'],
  ['airbnb', 'https://www.airbnb.com/'],
  ['github', 'https://github.com/'],
  ['reddit', 'https://www.reddit.com/']
];

async function worker(i: number, label: string, url: string, total?: number) {
  const outDir = path.join(path.dirname(new URL(import.meta.url).pathname), `../results/concurrent_10_${label}`);
  ensureDir(outDir);
  const client = new (Computer as any)();
  const computer = await client.create({ kind: 'browser' });
  await computer.navigate(url);
  try { await computer.wait(2); } catch {}
  const result = await computer.screenshot();
  const shotUrl = (result as any)?.result?.screenshot_url as string | undefined;
  if (shotUrl) {
    const img = path.join(outDir, `${timestamp(`${label}_${i}_`)}.png`);
    await downloadToFile(shotUrl, img);
    const prefix = total ? `[${i + 1}/${total}]` : `[${i + 1}]`;
    console.log(`${prefix} Saved: ${img}`);
    return img;
  }
  return '';
}

function parseArgsSite(): string | undefined {
  const idx = process.argv.indexOf('--site');
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1];
  return undefined;
}

function pickLabelUrl(site?: string): [string, string] {
  const labels = new Map(URLS);
  if (site) {
    if (labels.has(site)) return [site, labels.get(site)!];
    if (site.startsWith('http://') || site.startsWith('https://')) {
      try {
        const u = new URL(site);
        const host = u.hostname;
        const label = host.includes('.') ? host.split('.').slice(-2, -1)[0] : host;
        return [label || 'site', site];
      } catch { /* fallthrough */ }
      return ['site', site];
    }
  }
  return ['',''];
}

async function chooseSiteInteractive(): Promise<[string, string]> {
  const rl = readline.createInterface({ input, output });
  try {
    console.log('Choose a site to screenshot concurrently (10 shots):');
    URLS.forEach(([lbl, url], i) => console.log(`  ${i + 1}. ${lbl} -> ${url}`));
    const ans = await rl.question(`Enter number (1-${URLS.length}): `);
    const idx = Math.min(Math.max(parseInt(ans || '1', 10) || 1, 1), URLS.length) - 1;
    return URLS[idx];
  } finally {
    rl.close();
  }
}

async function run(n = 10) {
  let [label, url] = pickLabelUrl(parseArgsSite());
  if (!label || !url) {
    [label, url] = await chooseSiteInteractive();
  }
  const tasks = Array.from({ length: n }, (_, i) => worker(i, label, url, n));
  const results = await Promise.allSettled(tasks);
  for (const r of results) {
    if (r.status === 'fulfilled') console.log(`Saved: ${r.value}`);
    else console.warn('Worker failed:', r.reason);
  }
}

run(10);
