import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test, expect } from '@playwright/test';
import { E2E_ENABLED, E2E_SKIP_REASON, E2E_DB_DOWN_ENABLED } from './support/env';
import { resetDomainTables } from './support/db';

const DB_DOWN_URL = 'http://localhost:3201';

test.describe('Resilience @dbdown', () => {
  test.skip(!E2E_ENABLED, E2E_SKIP_REASON);
  test.skip(!E2E_DB_DOWN_ENABLED, 'Set E2E_DB_DOWN=1 to run the db-down server.');

  test.beforeEach(async () => {
    await resetDomainTables();
  });

  test('db outage renders boundary, digest, and one log line @dbdown', async ({ page }) => {
    await page.goto(`${DB_DOWN_URL}/events`);
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

  test('restoring the DB recovers after Try again @dbdown', async ({ page }) => {
    await page.goto(`${DB_DOWN_URL}/events`);
    await expect(page.getByText(/Something went wrong/i)).toBeVisible();

    const pidFile = resolve(process.cwd(), 'test-results', 'e2e-dbdown.pid');
    const pid = existsSync(pidFile)
      ? Number(readFileSync(pidFile, 'utf8').trim())
      : null;
    if (pid && Number.isFinite(pid)) {
      try {
        spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], {
          stdio: 'ignore',
          shell: true,
        });
      } catch {
        // ignore
      }
    }

    // Wait for the broken server to release port 3201.
    let down = false;
    for (let i = 0; i < 30; i += 1) {
      try {
        await fetch(DB_DOWN_URL, { signal: AbortSignal.timeout(1_000) });
      } catch {
        down = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    expect(down).toBeTruthy();

    const healthyEnv = { ...process.env, NODE_ENV: 'production' };
    const child = spawn('npx', ['next', 'start', '-p', '3201', '-H', 'localhost'], {
      cwd: process.cwd(),
      env: healthyEnv as NodeJS.ProcessEnv,
      detached: false,
      stdio: 'ignore',
      shell: true,
    });

    let ready = false;
    for (let i = 0; i < 120; i += 1) {
      try {
        const res = await fetch(DB_DOWN_URL, {
          signal: AbortSignal.timeout(2_000),
          redirect: 'manual',
        });
        if (res.status > 0) {
          ready = true;
          break;
        }
      } catch {
        // polling
      }
      await new Promise((r) => setTimeout(r, 1_000));
    }
    expect(ready).toBeTruthy();

    await page.getByRole('button', { name: /Try again/i }).click();
    await expect(page.getByRole('heading', { name: /Events/i })).toBeVisible({
      timeout: 30_000,
    });

    if (child.pid) {
      try {
        spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
          stdio: 'ignore',
          shell: true,
        });
      } catch {
        // ignore
      }
    }
  });
});