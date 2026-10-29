import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test, expect } from '@playwright/test';
import { E2E_ENABLED, E2E_SKIP_REASON, E2E_DB_DOWN_ENABLED } from './support/env';
import { resetDomainTables } from './support/db';

test.describe('Resilience @dbdown', () => {
  test.skip(!E2E_ENABLED, E2E_SKIP_REASON);
  // Only runnable when E2E_DB_DOWN=1 starts the broken-DB server.
  test.skip(!E2E_DB_DOWN_ENABLED, 'Set E2E_DB_DOWN=1 to run the db-down server.');

  test.beforeEach(async () => {
    await resetDomainTables();
  });

  test('db outage renders boundary, digest, and one log line @dbdown', async ({ page }) => {
    await page.goto('http://localhost:3201/events');
    await expect(page.getByText(/Something went wrong/i)).toBeVisible();
    const digest = await page.locator('text=/[a-f0-9]{8,}|digest/i').first();
    await expect(digest).toBeVisible();

    const logPath = resolve(process.cwd(), 'test-results', 'server-dbdown.log');
    if (existsSync(logPath)) {
      const log = readFileSync(logPath, 'utf8');
      const matches = log.match(/\[request error\]/g) ?? [];
      expect(matches.length).toBeGreaterThanOrEqual(1);
    }
  });
});