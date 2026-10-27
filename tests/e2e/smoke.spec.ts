import { expect, test } from '@playwright/test';
import { E2E_ENABLED, E2E_SKIP_REASON } from './support/env';

/**
 * Harness smoke test. Phase 5 replaces this with the real journeys; for now it
 * proves the Playwright project boots, reaches the app, and honours the
 * "no test branch -> skip" rule.
 */
test.describe('harness smoke', () => {
  test.skip(!E2E_ENABLED, E2E_SKIP_REASON);

  test('home page renders a heading', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });
});
