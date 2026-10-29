import { test, expect } from '@playwright/test';
import { E2E_ENABLED, E2E_SKIP_REASON } from './support/env';
import { storageStatePath } from './support/fixtures';
import { readRoster } from './support/fixtures';
import { resetDomainTables, prisma, seedEvent } from './support/db';

test.describe('Accessibility', () => {
  test.skip(!E2E_ENABLED, E2E_SKIP_REASON);

  test.beforeEach(async () => {
    await resetDomainTables();
  });

  for (const path of ['/', '/events', '/auth/sign-in', '/auth/sign-up']) {
    test(`axe clean on ${path} @smoke`, async ({ page }) => {
      await page.goto(path);
      const { runAxe } = await import('./support/axe');
      await runAxe(page);
    });
  }

  test.describe('signed-in surfaces', () => {
    test.use({ storageState: storageStatePath('organizer') });

    test('axe clean on create page', async ({ page }) => {
      await page.goto('/events/new');
      const { runAxe } = await import('./support/axe');
      await runAxe(page);
    });

    test('axe clean on dashboard', async ({ page }) => {
      const roster = readRoster();
      await seedEvent({ title: 'A11y dashboard event', userId: roster.organizer.userId });
      await page.goto('/my-events');
      const { runAxe } = await import('./support/axe');
      await runAxe(page);
    });

    test('axe clean on wishlist', async ({ page }) => {
      await page.goto('/wishlist');
      const { runAxe } = await import('./support/axe');
      await runAxe(page);
    });

    test('axe clean on notifications', async ({ page }) => {
      await page.goto('/notifications');
      const { runAxe } = await import('./support/axe');
      await runAxe(page);
    });

    test('axe clean on public event detail', async ({ page }) => {
      const roster = readRoster();
      const event = await seedEvent({ title: 'A11y public event', userId: roster.organizer.userId });
      await page.goto(`/events/${event.id}`);
      const { runAxe } = await import('./support/axe');
      await runAxe(page);
    });

  });
});