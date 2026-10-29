import { config as loadEnv } from 'dotenv';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const testEnvPath = resolve(process.cwd(), '.env.test');
if (existsSync(testEnvPath)) {
  loadEnv({ path: testEnvPath, quiet: true });
}

/** Base URL the Playwright web server listens on (E2E, separate from HTTP). */
export const E2E_BASE_URL =
  process.env.TEST_E2E_BASE_URL ?? 'http://localhost:3200';

/** Optional broken-DB server URL used by the @dbdown resilience spec. */
export const E2E_DB_DOWN_URL =
  process.env.TEST_E2E_DB_DOWN_URL ?? 'http://localhost:3201';

export const E2E_ENABLED =
  process.env.TEST_DB_ALLOW === '1' &&
  Boolean(process.env.DATABASE_URL) &&
  Boolean(process.env.NEON_AUTH_BASE_URL);

export const E2E_SKIP_REASON =
  'E2E requires an ephemeral test branch with its own auth service. Run ' +
  '`npm run db:test:up` first (it writes .env.test), then `npm run test:e2e`.';

export const E2E_DB_DOWN_ENABLED = process.env.E2E_DB_DOWN === '1';

export const ROLE_STORAGE_STATE = (role: string) =>
  resolve(process.cwd(), 'tests', '.auth', `${role}.json`);

export const E2E_ROSTER_PATH = resolve(
  process.cwd(),
  'tests',
  '.auth',
  'roster.json',
);