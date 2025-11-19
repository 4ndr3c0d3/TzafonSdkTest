import path from 'node:path';
import { ensureDir, timestamp, downloadToFile } from './utils.js';

type Engine = 'tzafon' | 'playwright';

function parseEngineArg(): Engine {
  const arg = process.argv.find(a => a.startsWith('--engine='));
  const value = (arg?.split('=')[1] ?? '').toLowerCase();
  if (value === 'playwright') return 'playwright';
  return 'tzafon';
}

async function runTzafon(outDir: string) {
  // Lazy import to avoid requiring tzafon at install time
  const { default: Computer } = await import('tzafon');
  const client = new Computer();
  const computer = await client.create({ kind: 'browser' });
  await computer.navigate('https://www.nytimes.com/');
  try { await computer.wait(2); } catch {}
  const result = await computer.screenshot();
  const url = (result as any)?.result?.screenshot_url as string | undefined;
  console.log(`Tzafon screenshot: ${url ?? 'n/a'}`);
  if (url) {
    const img = path.join(outDir, `${timestamp('nytimes_')}.png`);
    await downloadToFile(url, img);
    console.log(`Saved: ${img}`);
  }
}

async function runPlaywright(outDir: string) {
  let chromium: any;
  try {
    // Lazy import so tzafon users don't need Playwright installed
    ({ chromium } = await import('playwright'));
  } catch (err) {
    console.error('Playwright not installed. Install with: npm i -D playwright');
    throw err;
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  const page = await context.newPage();
  await page.goto('https://www.nytimes.com/', { waitUntil: 'domcontentloaded' });
  // Allow some settle time for hero images/ads
  try { await page.waitForTimeout(1500); } catch {}
  const img = path.join(outDir, `${timestamp('nytimes_')}.png`);
  await page.screenshot({ path: img, fullPage: true });
  console.log(`Saved: ${img}`);
  await browser.close();
}

async function run() {
  const outDir = path.join(path.dirname(new URL(import.meta.url).pathname), '../results/nytimes');
  ensureDir(outDir);

  const engine = parseEngineArg();
  console.log(`Engine: ${engine}`);
  if (engine === 'playwright') {
    await runPlaywright(outDir);
  } else {
    await runTzafon(outDir);
  }
}

run();
