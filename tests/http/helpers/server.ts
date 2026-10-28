import { execFileSync, spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const nextBin = require.resolve('next/dist/bin/next');

const baseUrl = process.env.TEST_BASE_URL ?? 'http://localhost:3100';
const url = new URL(baseUrl);
const port = Number(url.port || 3100);
const host = url.hostname;

const READY_TIMEOUT_MS = 60_000;
const BUILD_TIMEOUT_MS = 600_000;

let appProcess: ChildProcess | null = null;

/** True if something is already answering HTTP on the target port. */
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

async function waitUntilReady(): Promise<boolean> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await isPortReady()) return true;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

/** Build the production app using the same env the server will run with. */
function buildApp(): void {
  try {
    execFileSync(process.execPath, [nextBin, 'build'], {
      stdio: 'pipe',
      timeout: BUILD_TIMEOUT_MS,
      env: { ...process.env, NODE_ENV: 'production' },
    });
  } catch (error) {
    const details =
      error && typeof error === 'object' && 'stderr' in error
        ? String((error as { stderr?: unknown }).stderr)
        : '';
    throw new Error(
      `next build failed before starting test app: ${
        error instanceof Error ? error.message : String(error)
      }${details ? `\n${details}` : ''}`,
    );
  }
}

/**
 * Ensure the Next.js app is running on `TEST_BASE_URL`.
 *
 * Reuses an already-listening server (e.g. started externally in CI).
 * Otherwise builds (unless `build` is false) and runs `next start -p <port>` as
 * a child process. The caller owns teardown via `stopApp()`.
 */
export async function startApp({ build = true } = {}): Promise<void> {
  if (await isPortReady()) return;

  if (build) buildApp();

  appProcess = spawn(
    process.execPath,
    [nextBin, 'start', '-p', String(port)],
    {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, NODE_ENV: 'production' },
      detached: false,
    },
  );

  appProcess.stdout?.on('data', (chunk) => {
    if (process.env.HTTP_TEST_VERBOSE === '1') {
      process.stdout.write(`[test-app] ${chunk}`);
    }
  });
  appProcess.stderr?.on('data', (chunk) => {
    if (process.env.HTTP_TEST_VERBOSE === '1') {
      process.stderr.write(`[test-app-err] ${chunk}`);
    }
  });

  if (!(await waitUntilReady())) {
    stopApp();
    throw new Error(`Test app did not become ready on ${baseUrl}`);
  }
}

/** Kill the child process we started, if any. */
export function stopApp(): void {
  if (!appProcess) return;
  const pid = appProcess.pid;
  appProcess = null;
  if (!pid) return;

  try {
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], {
        stdio: 'ignore',
      });
    } else {
      process.kill(pid, 'SIGTERM');
    }
  } catch {
    // Ignore kill errors.
  }
}

export { baseUrl, port, host };
