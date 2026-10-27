import { defineConfig, devices } from '@playwright/test';
import { config as loadEnv } from 'dotenv';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { appAuthBaseUrl, assertTestDatabaseSafety } from './tests/support/env';

/**
 * Playwright is the only browser runner for this repo (no Cypress/Jest).
 *
 * E2E runs against a production build backed by the ephemeral test branch:
 *
 *   npm run db:test:up     # writes .env.test
 *   npm run test:e2e
 *
 * When `.env.test` is absent (or `TEST_DB_ALLOW` is not `1`) the config leaves
 * `webServer` unset and the specs skip themselves, so `playwright test` on a
 * clean checkout is a no-op rather than a misleading failure.
 */

const testEnvPath = resolve(process.cwd(), '.env.test');
const hasTestEnvFile = existsSync(testEnvPath);
if (hasTestEnvFile) {
  loadEnv({ path: testEnvPath, quiet: true });
}

function hostOf(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).host;
  } catch {
    return null;
  }
}

// Neon Auth's `allow_localhost` trusts `localhost` but not `127.0.0.1`.
const baseURL = process.env.TEST_BASE_URL ?? 'http://localhost:3100';
const port = Number(new URL(baseURL).port || 3100);

const dbReady =
  hasTestEnvFile &&
  process.env.TEST_DB_ALLOW === '1' &&
  Boolean(process.env.DATABASE_URL);

// A test run must never authenticate against production. Missing auth vars
// would otherwise fall through to `.env` during `next build`/`next start`.
const authHost = hostOf(process.env.NEON_AUTH_BASE_URL);
const appAuthHost = hostOf(appAuthBaseUrl());
const authIsIsolated = Boolean(authHost) && authHost !== appAuthHost;

if (dbReady && !authIsIsolated) {
  throw new Error(
    [
      '.env.test is missing a branch-scoped NEON_AUTH_BASE_URL.',
      'Without it the app build falls back to production auth from `.env`.',
      'Fix: run `npm run db:test:up -- --force` (or `npm run db:test:down` first).',
    ].join('\n'),
  );
}

const e2eEnabled = dbReady && authIsIsolated;

// Refuse production hosts (database and auth) before starting the app.
if (e2eEnabled) assertTestDatabaseSafety();

const appEnv: Record<string, string> = {};
for (const [key, value] of Object.entries(process.env)) {
  if (value !== undefined) appEnv[key] = value;
}

export default defineConfig({
  testDir: './tests/e2e',
  outputDir: 'test-results',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI
    ? [
        ['github'],
        ['html', { outputFolder: 'playwright-report', open: 'never' }],
      ]
    : [
        ['list'],
        ['html', { outputFolder: 'playwright-report', open: 'never' }],
      ],
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile-chromium', use: { ...devices['Pixel 7'] } },
  ],
  webServer: e2eEnabled
    ? {
        command: `npm run build && npm run start -- -p ${port}`,
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 300_000,
        env: appEnv,
      }
    : undefined,
});
