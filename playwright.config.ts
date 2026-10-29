import { defineConfig, devices } from '@playwright/test';
import { config as loadEnv } from 'dotenv';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { appAuthBaseUrl, assertTestDatabaseSafety } from './tests/support/env';

/**
 * Playwright is the only browser runner for this repo.
 *
 * E2E uses its own port (3200 by default via TEST_E2E_BASE_URL) so it can
 * never silently attach to the HTTP test server on 3100 or a stale dev server.
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

const e2eBaseURL = process.env.TEST_E2E_BASE_URL ?? 'http://localhost:3200';
const e2ePort = Number(new URL(e2eBaseURL).port || 3200);

const dbReady =
  hasTestEnvFile &&
  process.env.TEST_DB_ALLOW === '1' &&
  Boolean(process.env.DATABASE_URL);

const authHost = hostOf(process.env.NEON_AUTH_BASE_URL);
const appAuthHost = hostOf(appAuthBaseUrl());
const authIsIsolated = Boolean(authHost) && authHost !== appAuthHost;

if (dbReady && !authIsIsolated) {
  throw new Error(
    [
      '.env.test is missing a branch-scoped NEON_AUTH_BASE_URL.',
      'Without it the app build falls back to production auth from `.env`.',
    ].join('\n'),
  );
}

const e2eEnabled = dbReady && authIsIsolated;

if (e2eEnabled) assertTestDatabaseSafety();

const appEnv: Record<string, string> = {};
for (const [key, value] of Object.entries(process.env)) {
  if (value !== undefined) appEnv[key] = value;
}
appEnv.TEST_E2E_BASE_URL = e2eBaseURL;

export default defineConfig({
  testDir: './tests/e2e',
  globalSetup: e2eEnabled ? './tests/e2e/global-setup.ts' : undefined,
  globalTeardown: e2eEnabled ? './tests/e2e/global-teardown.ts' : undefined,
  outputDir: 'test-results',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: 1,
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
    baseURL: e2eBaseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'setup',
      testMatch: /auth\.setup\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'chromium',
      dependencies: ['setup'],
      use: {
        ...devices['Desktop Chrome'],
      },
      testIgnore: /auth\.setup\.ts/,
    },
    {
      name: 'mobile-chromium',
      dependencies: ['setup'],
      use: {
        ...devices['Pixel 7'],
      },
      grep: /@mobile/,
      testIgnore: /auth\.setup\.ts/,
    },
  ],
  webServer: e2eEnabled
    ? {
        command: 'npx tsx scripts/start-test-app.ts',
        url: e2eBaseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 300_000,
        env: appEnv,
      }
    : undefined,
});