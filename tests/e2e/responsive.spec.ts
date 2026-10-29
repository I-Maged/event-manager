import { test, expect } from '@playwright/test';
import { E2E_ENABLED, E2E_SKIP_REASON } from './support/env';
import { storageStatePath } from './support/fixtures';
import { readRoster } from './support/fixtures';
import { resetDomainTables, seedEvent } from './support/db';

test.describe('Responsive @mobile', () => {
  test.skip(!E2E_ENABLED, E2E_SKIP_REASON);

  test.beforeEach(async () => {
    await resetDomainTables();
  });

  function noOverflow() {
    return document.documentElement.scrollWidth > window.innerWidth;
  }

  test('no horizontal overflow on home @mobile', async ({ page }) => {
    await page.goto('/');
    expect(await page.evaluate(noOverflow)).toBeFalsy();
  });

  test('no horizontal overflow on browse @mobile', async ({ page }) => {
    await page.goto('/events');
    expect(await page.evaluate(noOverflow)).toBeFalsy();
  });

  test('mobile navigation drawer is keyboard operable @mobile', async ({ page }) => {
    await page.goto('/');
    const toggle = page.getByRole('button', { name: /Open menu|Close menu/ });
    if (!(await toggle.isVisible())) return;
    await toggle.focus();
    await toggle.press('Enter');
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('Escape');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  test.describe('signed-in pages', () => {
    test.use({ storageState: storageStatePath('organizer') });

    test('no horizontal overflow on create @mobile', async ({ page }) => {
      await page.goto('/events/new');
      expect(await page.evaluate(noOverflow)).toBeFalsy();
    });

    test('no horizontal overflow on detail @mobile', async ({ page }) => {
      const roster = readRoster();
      const event = await seedEvent({ title: 'Responsive detail event', userId: roster.organizer.userId });
      await page.goto(`/events/${event.id}`);
      expect(await page.evaluate(noOverflow)).toBeFalsy();
    });

    test('no horizontal overflow on dashboard @mobile', async ({ page }) => {
      await page.goto('/my-events');
      expect(await page.evaluate(noOverflow)).toBeFalsy();
    });

    test('no horizontal overflow on wishlist @mobile', async ({ page }) => {
      await page.goto('/wishlist');
      expect(await page.evaluate(noOverflow)).toBeFalsy();
    });

    test('no horizontal overflow on notifications @mobile', async ({ page }) => {
      await page.goto('/notifications');
      expect(await page.evaluate(noOverflow)).toBeFalsy();
    });
  });
});