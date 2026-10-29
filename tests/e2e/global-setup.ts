import { config as loadEnv } from 'dotenv';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

export default async function globalSetup(): Promise<void> {
  const testEnvPath = resolve(process.cwd(), '.env.test');
  if (existsSync(testEnvPath)) {
    loadEnv({ path: testEnvPath, quiet: true });
  }

  const { assertTestDatabaseSafety } = await import('../support/env');
  assertTestDatabaseSafety();

  const { resetDomainTables } = await import('./support/db');
  await resetDomainTables();

  if (process.env.E2E_DB_DOWN !== '1') return;

  const dbDownUrl =
    process.env.TEST_E2E_DB_DOWN_URL ?? 'http://localhost:3201';
  const dbDownPort = Number(new URL(dbDownUrl).port || 3201);
  mkdirSync(resolve(process.cwd(), 'test-results'), { recursive: true });
  const logPath = resolve(process.cwd(), 'test-results', 'server-dbdown.log');
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value;
  }
  env.TEST_BASE_URL = dbDownUrl;
  env.TEST_E2E_BASE_URL = dbDownUrl;
  env.DATABASE_URL =
    'postgresql://invalid:invalid@127.0.0.1:1/neondb?sslmode=require';
  env.DATABASE_URL_UNPOOLED = env.DATABASE_URL;
  env.E2E_SKIP_BUILD = '1';
  env.E2E_SERVER_LOG = logPath;

  const child: any = spawn('npx', ['tsx', 'scripts/start-test-app.ts'], {
    cwd: process.cwd(),
    env: env as NodeJS.ProcessEnv,
    detached: false,
    stdio: 'ignore',
    shell: true,
  });

  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(dbDownUrl, {
        signal: AbortSignal.timeout(2_000),
        redirect: 'manual',
      });
      if (res.status > 0) break;
    } catch {
      // polling
    }
    await new Promise((r) => setTimeout(r, 500));
  }

  if (child.pid) {
    writeFileSync(
      resolve(process.cwd(), 'test-results', 'e2e-dbdown.pid'),
      String(child.pid),
      'utf8',
    );
  }
}