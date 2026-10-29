import { test, expect } from '@playwright/test';
import { E2E_ENABLED, E2E_SKIP_REASON } from './support/env';
import { resetDomainTables } from './support/db';

test.describe('Responsive @mobile', () => {
  test.skip(!E2E_ENABLED, E2E_SKIP_REASON);
  // Tag the describe title so it is picked up by the mobile project's grep? Playwright grep matches test titles.
  // Tests below explicitly include @mobile in their titles.

  test.beforeEach(async () => {
    await resetDomainTables();
  });

  test('no horizontal overflow on home @mobile @smoke', async ({ page }) => {
    await page.goto('/');
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    expect(overflow).toBeFalsy();
  });

  test('no horizontal overflow on browse @mobile', async ({ page }) => {
    await page.goto('/events');
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    expect(overflow).toBeFalsy();
  });
});