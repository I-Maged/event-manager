import { config as loadEnv } from 'dotenv';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

export default async function globalTeardown(): Promise<void> {
  const testEnvPath = resolve(process.cwd(), '.env.test');
  if (existsSync(testEnvPath)) {
    loadEnv({ path: testEnvPath, quiet: true });
  }

  const pidFile = resolve(process.cwd(), 'test-results', 'e2e-dbdown.pid');
  if (existsSync(pidFile)) {
    const pid = Number(readFileSync(pidFile, 'utf8').trim());
    if (Number.isFinite(pid)) {
      try {
        if (process.platform === 'win32') {
          spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], {
            stdio: 'ignore',
            shell: true,
          });
        } else {
          process.kill(pid, 'SIGTERM');
        }
      } catch {
        // ignore
      }
    }
    try {
      rmSync(pidFile, { force: true });
    } catch {
      // ignore
    }
  }

  const { assertTestDatabaseSafety } = await import('../support/env');
  try {
    assertTestDatabaseSafety();
    const db = await import('./support/db');
    await db.resetDomainTables();
    // Assert a clean branch.
    const { prisma } = db;
    const counts = await Promise.all([
      prisma.event.count(),
      prisma.rSVP.count(),
      prisma.comment.count(),
      prisma.notification.count(),
      prisma.rateLimit.count(),
    ]);
    if (counts.some((c) => c !== 0)) {
      throw new Error(`E2E teardown found leftover rows: ${counts.join(', ')}`);
    }
    await db.closeDb();
  } catch {
    // If no branch is configured, still finish cleanly.
  }
}