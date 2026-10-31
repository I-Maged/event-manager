import { test, expect } from '@playwright/test';
import { E2E_ENABLED, E2E_SKIP_REASON } from './support/env';
import { storageStatePath } from './support/fixtures';
import { readRoster } from './support/fixtures';
import { resetDomainTables, prisma, seedEvent, seedComment, seedComments } from './support/db';
import { newRolePage } from './support/context';

test.describe('Comments', () => {
  test.use({ storageState: storageStatePath('organizer') });
  test.skip(!E2E_ENABLED, E2E_SKIP_REASON);

  test.beforeEach(async () => {
    await resetDomainTables();
  });

  async function createEvent() {
    const roster = readRoster();
    return seedEvent({
      title: 'Comment event',
      userId: roster.organizer.userId,
      organizerName: 'Org',
    });
  }

  test('add comment and count updates @smoke', async ({ page }) => {
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
      await expect(page.getByText(`Comment ${i}`)).toBeVisible();
    }
    await expect(page.locator('.alert-error').filter({ hasText: /too many/i })).toBeVisible();
  });

  test('51 seeded comments show the count and render 50', async ({ page }) => {
    const roster = readRoster();
    const event = await createEvent();
    await seedComments(event.id, 51, roster.organizer.userId);
    await page.goto(`/events/${event.id}`);
    await expect(page.getByText('Comments (51)')).toBeVisible();
    const count = await page.locator('ul.space-y-3 > li').count();
    expect(count).toBe(50);
  });

  test('delete your own comment', async ({ page }) => {
    const event = await createEvent();
    await page.goto(`/events/${event.id}`);
    await page.getByPlaceholder('Ask a question or share details…').fill('Delete me');
    await page.getByRole('button', { name: 'Post comment' }).click();
    await expect(page.getByText('Delete me')).toBeVisible();
    page.on('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: 'Delete' }).first().click();
    await expect(page.getByText('Delete me')).toHaveCount(0);
  });

  test('organizer can delete another user’s comment', async ({ page }) => {
    const roster = readRoster();
    const event = await createEvent();
    await seedComment(event.id, 'other-commenter', { authorName: 'Other commenter', body: 'Organizer can delete this' });
    await page.goto(`/events/${event.id}`);
    await expect(page.getByText('Organizer can delete this')).toBeVisible();
    page.on('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: 'Delete' }).first().click();
    await expect(page.getByText('Organizer can delete this')).toHaveCount(0);
  });

  test('other users cannot delete someone else’s comment', async ({ browser }) => {
    const roster = readRoster();
    const event = await createEvent();
    await seedComment(event.id, roster.organizer.userId, { authorName: 'Organizer author', body: 'Protected comment' });

    const { context, page } = await newRolePage(browser, 'attendee');
    await page.goto(`/events/${event.id}`);
    await expect(page.getByText('Protected comment')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Delete' })).toHaveCount(0);
    await context.close();
  });

  test('past event comments are read-only', async ({ page }) => {
    const event = await createEvent();
    await prisma.event.update({
      where: { id: event.id },
      data: { date: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    });
    await page.goto(`/events/${event.id}`);
    await expect(page.getByText('This event has ended — comments are read-only.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Post comment' })).toHaveCount(0);
  });

  test('organizer badge renders on the organizer’s comment', async ({ page }) => {
    const roster = readRoster();
    const event = await createEvent();
    await seedComment(event.id, roster.organizer.userId, { authorName: 'Org', body: 'Organizer badge comment' });
    await page.goto(`/events/${event.id}`);
    await expect(page.getByText('Organizer badge comment')).toBeVisible();
    await expect(page.getByText('Organizer', { exact: true })).toBeVisible();
  });

  test('stored XSS in an author name does not execute', async ({ page }) => {
    let triggered = false;
    page.on('dialog', () => {
      triggered = true;
    });
    await page.addInitScript(() => {
      (window as any).__xss = false;
    });
    const roster = readRoster();
    const event = await createEvent();
    await seedComment(event.id, 'xss-author', {
      authorName: '<img src=x onerror=window.__xss=true>',
      body: 'XSS author body',
    });
    await page.goto(`/events/${event.id}`);
    const xss = await page.evaluate(() => (window as any).__xss === true);
    expect(xss || triggered).toBeFalsy();
  });
});