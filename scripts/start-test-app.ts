import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
const nextBin = require.resolve('next/dist/bin/next');

const baseUrl =
  process.env.TEST_E2E_BASE_URL ??
  process.env.TEST_BASE_URL ??
  'http://localhost:3200';
const url = new URL(baseUrl);
const port = Number(url.port || 3200);
const host = url.hostname;

const logPath = resolve(
  process.cwd(),
  process.env.E2E_SERVER_LOG ?? 'test-results/server.log',
);
mkdirSync(resolve(process.cwd(), 'test-results'), { recursive: true });

const logStream = createWriteStream(logPath, { flags: 'a' });
function tee(prefix: string, chunk: Buffer) {
  if (process.env.E2E_VERBOSE === '1' || process.env.HTTP_TEST_VERBOSE === '1') {
    process.stdout.write(`${prefix} ${chunk}`);
  }
  logStream.write(chunk);
}

async function isPortReady(): Promise<boolean> {
  try {
    const res = await fetch(baseUrl, {
      signal: AbortSignal.timeout(2_000),
      redirect: 'manual',
    });
    return res.status > 0;
  } catch {
    return false;
  }
}

async function waitUntilReady(timeoutMs = 90_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isPortReady()) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

function buildApp() {
  try {
    execFileSync(process.execPath, [nextBin, 'build'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 600_000,
      env: { ...process.env, NODE_ENV: 'production' },
      cwd: process.cwd(),
    });
  } catch (error) {
    const details =
      error && typeof error === 'object' && 'stderr' in error
        ? String((error as { stderr?: unknown }).stderr)
        : '';
    const message = error instanceof Error ? error.message : String(error);
    logStream.write(`[start-test-app] BUILD FAILED: ${message}\n${details}\n`);
    throw new Error(`next build failed: ${message}${details ? `\n${details}` : ''}`);
  }
}

async function main() {
  if (await isPortReady()) {
    logStream.write(`[start-test-app] reusing existing server on ${baseUrl}\n`);
    logStream.end();
    return;
  }

  if (process.env.E2E_SKIP_BUILD !== '1') buildApp();

  const child = spawn(process.execPath, [nextBin, 'start', '-p', String(port), '-H', host], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, NODE_ENV: 'production' },
    cwd: process.cwd(),
    detached: false,
  });

  child.stdout?.on('data', (chunk: Buffer) => tee('[test-app]', chunk));
  child.stderr?.on('data', (chunk: Buffer) => tee('[test-app-err]', chunk));

  const stop = () => {
    const pid = child.pid;
    if (!pid) return;
    try {
      if (process.platform === 'win32') {
        spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
      } else {
        process.kill(pid, 'SIGTERM');
      }
    } catch {
      // ignore
    }
  };

  process.on('SIGINT', () => {
    stop();
    process.exit(130);
  });
  process.on('SIGTERM', () => {
    stop();
    process.exit(143);
  });

  if (!(await waitUntilReady())) {
    stop();
    throw new Error(`Test app did not become ready on ${baseUrl}`);
  }

  // Keep the node process alive; forward nothing further.
  await new Promise<void>((resolve) => {
    child.on('exit', () => resolve());
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});