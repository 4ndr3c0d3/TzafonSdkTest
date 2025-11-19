import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { spawn } from 'node:child_process';
import path from 'node:path';

function runProc(cmd: string, args: string[], cwd?: string) {
  const child = spawn(cmd, args, { cwd, stdio: 'inherit', env: process.env });
  child.on('exit', (code) => {
    console.log(`\n[process exited with code ${code}]`);
  });
}

async function promptGateway(rl: readline.Interface) {
  const url = (await rl.question('Target URL [https://www.wikipedia.org/]: ')).trim() || 'https://www.wikipedia.org/';
  const engineRaw = (await rl.question('Engine [playwright|tzafon] (default playwright): ')).trim().toLowerCase();
  const engine = engineRaw === 'tzafon' ? 'tzafon' as const : 'playwright' as const;
  const tabsRaw = (await rl.question('Tabs (default 3): ')).trim();
  const tabs = Math.max(1, Math.min(50, parseInt(tabsRaw || '3', 10) || 3));
  const browserSvc = (await rl.question('Browser service base [http://127.0.0.1:8000]: ')).trim() || 'http://127.0.0.1:8000';
  const pythonSvc = (await rl.question('Python service base [http://127.0.0.1:8001]: ')).trim() || 'http://127.0.0.1:8001';
  const cwd = path.dirname(new URL(import.meta.url).pathname);
  console.log('\n[gateway] starting...');
  runProc(process.execPath, ['--loader', 'tsx', 'src/main.ts', `--url=${url}`, `--engine=${engine}`, `--tabs=${tabs}`, `--browser=${browserSvc}`, `--python=${pythonSvc}`], cwd);
}

async function main() {
  const rl = readline.createInterface({ input, output });
  const cwd = path.dirname(new URL(import.meta.url).pathname);
  try {
    console.log('Microservices Menu');
    console.log('1) Start Python Playwright Service (:8002)');
    console.log('2) Start Python tzafon Service (:8001)');
    console.log('3) Start TypeScript Browser Service (:8000)');
    console.log('4) Run Gateway (orchestrator)');
    console.log('5) Quit');
    const ans = await rl.question('Select an option [1-4]: ');
    const choice = parseInt(ans.trim() || '1', 10);
    switch (choice) {
      case 1:
        console.log('\n[Starting Python Playwright Service on :8002]');
        {
          const py = process.env.PYTHON || 'python';
          const repoRoot = path.join(cwd, '..');
          runProc(py, ['python/playwright_service.py'], repoRoot);
        }
        break;
      case 2: {
        console.log('\n[Starting Python tzafon Service on :8001]');
        // Allow overriding python executable via env
        const py = process.env.PYTHON || 'python';
        const repoRoot = path.join(cwd, '..');
        runProc(py, ['python/service.py'], repoRoot);
        break;
      }
      case 3:
        console.log('\n[Starting TypeScript Browser Service on :8000]');
        runProc(process.execPath, ['--loader', 'tsx', 'src/services/browserService.ts'], cwd);
        break;
      case 4:
        await promptGateway(rl);        
        break;
      default:
        console.log('Bye.');
        break;
    }
  } finally {
    // keep process alive if a child is running; otherwise close
    setTimeout(() => rl.close(), 50);
  }
}

main().catch((e) => {
  console.error('Menu error:', e);
  process.exitCode = 1;
});
