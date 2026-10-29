import { test, expect } from '@playwright/test';
import { E2E_ENABLED, E2E_SKIP_REASON } from './support/env';
import { resetDomainTables } from './support/db';
import { runAxe } from './support/axe';

test.describe('Accessibility', () => {
  test.skip(!E2E_ENABLED, E2E_SKIP_REASON);

  test.beforeEach(async () => {
    await resetDomainTables();
  });

  for (const path of ['/', '/events', '/auth/sign-in', '/auth/sign-up']) {
    test(`axe clean on ${path}`, async ({ page }) => {
      await page.goto(path);
      await runAxe(page);
    });
  }
});