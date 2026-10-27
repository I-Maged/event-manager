import { config as loadEnv } from 'dotenv';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

// Workers may not inherit dotenv mutations made while loading the Playwright
// config, so load the test env here as well. No `.env` fallback on purpose.
const testEnvPath = resolve(process.cwd(), '.env.test');
if (existsSync(testEnvPath)) {
  loadEnv({ path: testEnvPath, quiet: true });
}

/** Tests skip themselves when no ephemeral test branch has been prepared. */
export const E2E_ENABLED =
  process.env.TEST_DB_ALLOW === '1' &&
  Boolean(process.env.DATABASE_URL) &&
  Boolean(process.env.NEON_AUTH_BASE_URL);

export const E2E_SKIP_REASON =
  'E2E requires an ephemeral test branch with its own auth service. Run ' +
  '`npm run db:test:up` first (it writes .env.test), then `npm run test:e2e`.';
