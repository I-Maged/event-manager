import { test, expect } from '@playwright/test';
import { E2E_ENABLED, E2E_SKIP_REASON } from './support/env';
import { storageStatePath } from './support/fixtures';
import { readRoster } from './support/fixtures';
import { resetDomainTables, seedEvent } from './support/db';

test.describe('Calendar links', () => {
  test.use({ storageState: storageStatePath('organizer') });
  test.skip(!E2E_ENABLED, E2E_SKIP_REASON);

  test.beforeEach(async () => {
    await resetDomainTables();
  });

  test('ICS link downloads a valid file @smoke', async ({ page }) => {
    const roster = readRoster();
    const event = await seedEvent({
      title: 'Calendar event',
      userId: roster.organizer.userId,
      timeZone: 'Europe/Berlin',
    });
    await page.goto(`/events/${event.id}`);
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('link', { name: /\.ics|calendar|add to calendar/i }).first().click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.ics$/i);
  });

  test('Google Calendar link contains encoded event parameters', async ({ page }) => {
    const roster = readRoster();
    const event = await seedEvent({
      title: 'Calendar event',
      userId: roster.organizer.userId,
      timeZone: 'Europe/Berlin',
    });
    await page.goto(`/events/${event.id}`);
    const link = page.getByRole('link', { name: /Add to Google|Google/i }).first();
    await expect(link).toHaveAttribute('href', /calendar\.google\.com/);
    await expect(link).toHaveAttribute('href', /Calendar\+event/);
  });
});