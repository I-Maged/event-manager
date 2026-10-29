import { test, expect } from '@playwright/test';
import { E2E_ENABLED, E2E_SKIP_REASON } from './support/env';
import { storageStatePath } from './support/fixtures';
import { readRoster } from './support/fixtures';
import { resetDomainTables, prisma } from './support/db';

test.describe('Comments', () => {
  test.use({ storageState: storageStatePath('organizer') });
  test.skip(!E2E_ENABLED, E2E_SKIP_REASON);

  test.beforeEach(async () => {
    await resetDomainTables();
  });

  async function createEvent() {
    const roster = readRoster();
    return prisma.event.create({
      data: {
        title: 'Comment event',
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
  }

  test('add comment and count updates', async ({ page }) => {
    const event = await createEvent();
    await page.goto(`/events/${event.id}`);
    await page.getByPlaceholder('Ask a question or share details…').fill('Hello world');
    await page.getByRole('button', { name: 'Post comment' }).click();
    await expect(page.getByText('Hello world')).toBeVisible();
    await expect(page.getByText('Comments (1)')).toBeVisible();
  });

  test('signed-out user sees sign-in prompt instead of form', async ({ browser }) => {
    const event = await createEvent();
    const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await ctx.newPage();
    await page.goto(`/events/${event.id}`);
    await expect(page.getByText('to join the discussion')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Post comment' })).toHaveCount(0);
    await ctx.close();
  });

  test('6th rapid comment shows the rate-limit message', async ({ page }) => {
    const event = await createEvent();
    await page.goto(`/events/${event.id}`);
    for (let i = 0; i < 6; i += 1) {
      const box = page.getByPlaceholder('Ask a question or share details…');
      await box.fill(`Comment ${i}`);
      await page.getByRole('button', { name: 'Post comment' }).click();
      await page.waitForTimeout(100);
    }
    await expect(page.locator('.alert-error').filter({ hasText: /too many/i })).toBeVisible();
  });
});