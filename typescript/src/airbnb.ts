import Computer from 'tzafon';
import path from 'node:path';
import { ensureDir, timestamp, downloadToFile } from './utils.js';

async function run() {
  const outDir = path.join(path.dirname(new URL(import.meta.url).pathname), '../results/airbnb');
  ensureDir(outDir);

  const client = new Computer();
  const computer = await client.create({ kind: 'browser' });
  await computer.navigate('https://www.airbnb.com/');
  try { await computer.wait(2); } catch {}
  const result = await computer.screenshot();
  const url = (result as any)?.result?.screenshot_url as string | undefined;
  console.log(`Screenshot: ${url}`);
  if (url) {
    const img = path.join(outDir, `${timestamp('airbnb_')}.png`);
    await downloadToFile(url, img);
    console.log(`Saved: ${img}`);
  }
}

run();
