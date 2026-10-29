import { test, expect } from '@playwright/test';
import { E2E_ENABLED, E2E_SKIP_REASON } from './support/env';
import { storageStatePath } from './support/fixtures';
import { readRoster } from './support/fixtures';
import { resetDomainTables, prisma } from './support/db';

test.describe('Wishlist', () => {
  test.use({ storageState: storageStatePath('organizer') });
  test.skip(!E2E_ENABLED, E2E_SKIP_REASON);

  test.beforeEach(async () => {
    await resetDomainTables();
  });

  test('empty state renders', async ({ page }) => {
    await page.goto('/wishlist');
    await expect(page.getByText('Your wishlist is empty')).toBeVisible();
  });

  test('positions render and leave works', async ({ page }) => {
    const roster = readRoster();
    const event = await prisma.event.create({
      data: {
        title: 'Wishlist event',
        description: 'desc',
        date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        timeZone: 'Europe/Berlin',
        location: 'Somewhere',
        maxAttendees: 1,
        isPublic: true,
        category: 'OTHER',
        userId: roster.organizer.userId,
        organizerName: 'Org',
      },
    });
    await prisma.rSVP.create({
      data: {
        eventId: event.id,
        userId: roster.organizer.userId,
        status: 'WAITLISTED',
        createdAt: new Date(),
      },
    });
    await page.goto('/wishlist');
    await expect(page.getByText('#1 on wishlist')).toBeVisible();
  });
});