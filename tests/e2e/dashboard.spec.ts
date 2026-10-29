import { test, expect } from '@playwright/test';
import { E2E_ENABLED, E2E_SKIP_REASON } from './support/env';
import { storageStatePath } from './support/fixtures';
import { readRoster } from './support/fixtures';
import { resetDomainTables, prisma } from './support/db';

test.describe('Organizer dashboard', () => {
  test.use({ storageState: storageStatePath('organizer') });
  test.skip(!E2E_ENABLED, E2E_SKIP_REASON);

  test.beforeEach(async () => {
    await resetDomainTables();
  });

  test('dashboard renders for organizer', async ({ page }) => {
    const roster = readRoster();
    await prisma.event.create({
      data: {
        title: 'Dashboard event',
        description: 'desc',
        date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        timeZone: 'Europe/Berlin',
        location: 'Somewhere',
        isPublic: true,
        category: 'OTHER',
        userId: roster.organizer.userId,
        organizerName: 'Org',
      },
    });
    await page.goto('/my-events');
    await expect(page.getByText('Dashboard event')).toBeVisible();
  });

  test('non-organizer user sees an empty dashboard', async ({ browser }) => {
    const ctx = await browser.newContext({
      storageState: storageStatePath('outsider'),
    });
    const page = await ctx.newPage();
    await page.goto('/my-events');
    await expect(page.getByText("You haven't organized any events yet.")).toBeVisible();
    await ctx.close();
  });
});