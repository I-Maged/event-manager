import { test, expect } from '@playwright/test';
import { E2E_ENABLED, E2E_SKIP_REASON } from './support/env';
import { storageStatePath } from './support/fixtures';
import { readRoster } from './support/fixtures';
import { resetDomainTables, prisma } from './support/db';

test.describe('Calendar links', () => {
  test.use({ storageState: storageStatePath('organizer') });
  test.skip(!E2E_ENABLED, E2E_SKIP_REASON);

  test.beforeEach(async () => {
    await resetDomainTables();
  });

  test('ICS link downloads a valid file', async ({ page }) => {
    const roster = readRoster();
    const event = await prisma.event.create({
      data: {
        title: 'Calendar event',
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
    await page.goto(`/events/${event.id}`);
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('link', { name: /\.ics|calendar|add to calendar/i }).first().click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.ics$/i);
  });
});