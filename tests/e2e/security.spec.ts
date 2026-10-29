import { test, expect } from '@playwright/test';
import { E2E_ENABLED, E2E_SKIP_REASON } from './support/env';
import { storageStatePath } from './support/fixtures';
import { readRoster } from './support/fixtures';
import { resetDomainTables, prisma } from './support/db';

test.describe('Security', () => {
  test.use({ storageState: storageStatePath('organizer') });
  test.skip(!E2E_ENABLED, E2E_SKIP_REASON);

  test.beforeEach(async () => {
    await resetDomainTables();
  });

  test('private title is absent for an outsider @smoke', async ({ browser }) => {
    const roster = readRoster();
    const event = await prisma.event.create({
      data: {
        title: 'SECRET TITLE',
        description: 'secret body',
        date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        timeZone: 'Europe/Berlin',
        location: 'Somewhere',
        isPublic: false,
        category: 'OTHER',
        userId: roster.organizer.userId,
        organizerName: 'Org',
      },
    });
    const ctx = await browser.newContext({ storageState: storageStatePath('outsider') });
    const page = await ctx.newPage();
    await page.goto(`/events/${event.id}`);
    const html = await page.content();
    expect(html).not.toContain('SECRET TITLE');
    await ctx.close();
  });

  test('stored XSS payload does not execute', async ({ page }) => {
    let triggered = false;
    page.on('dialog', () => {
      triggered = true;
    });
    await page.addInitScript(() => {
      (window as any).__xss = false;
    });
    const roster = readRoster();
    const event = await prisma.event.create({
      data: {
        title: '<img src=x onerror=window.__xss=true>',
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
    await page.waitForTimeout(500);
    const xss = await page.evaluate(() => (window as any).__xss === true);
    expect(xss || triggered).toBeFalsy();
  });
});