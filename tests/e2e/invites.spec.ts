import { test, expect } from '@playwright/test';
import { E2E_ENABLED, E2E_SKIP_REASON } from './support/env';
import { storageStatePath } from './support/fixtures';
import { resetDomainTables, prisma } from './support/db';
import { readRoster } from './support/fixtures';

test.describe('Private events and invites', () => {
  test.use({ storageState: storageStatePath('organizer') });
  test.skip(!E2E_ENABLED, E2E_SKIP_REASON);

  test.beforeEach(async () => {
    await resetDomainTables();
  });

  async function createPrivateEvent(page: any) {
    await page.goto('/events/new');
    await page.getByLabel('Title').fill('Private event');
    await page.getByLabel('Description').fill('Private details');
    await page.getByLabel('Date and time').fill(
      new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 16),
    );
    await page.getByLabel('Location').fill('Secret venue');
    await page.getByLabel('Public event (anyone can discover it)').uncheck();
    await page.getByRole('button', { name: 'Create event' }).click();
    await page.waitForURL(/\/events\/[^/]+$/);
    return page.url();
  }

  test('organizer can create an invite link', async ({ page }) => {
    await createPrivateEvent(page);
    await page.getByRole('button', { name: 'Create invite link' }).click();
    await expect(page.getByRole('status')).toContainText('Invite link ready');
    await expect(page.getByLabel('Invite link')).toHaveValue(/\/invite\//);
  });

  test('regenerating replaces the token', async ({ page }) => {
    await createPrivateEvent(page);
    await page.getByRole('button', { name: 'Create invite link' }).click();
    const first = await page.getByLabel('Invite link').inputValue();
    page.on('dialog', (d) => d.accept());
    await page.getByRole('button', { name: 'Regenerate link' }).click();
    await expect(page.getByRole('status')).toContainText('New invite link generated');
    const second = await page.getByLabel('Invite link').inputValue();
    expect(second).not.toBe(first);
  });

  test('revoked link shows Invite not found', async ({ page, browser }) => {
    await createPrivateEvent(page);
    await page.getByRole('button', { name: 'Create invite link' }).click();
    const token = (await page.getByLabel('Invite link').inputValue()).split('/').pop()!;
    page.on('dialog', (d) => d.accept());
    await page.getByRole('button', { name: 'Revoke link' }).click();
    await expect(page.getByRole('status')).toContainText('Invite link revoked');

    const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const p = await ctx.newPage();
    await p.goto(`/invite/${token}`);
    await expect(p.getByText('Invite not found')).toBeVisible();
    await ctx.close();
  });

  test('private event preview hides description', async ({ page, browser }) => {
    await createPrivateEvent(page);
    await page.getByRole('button', { name: 'Create invite link' }).click();
    const raw = await page.getByLabel('Invite link').inputValue();
    const token = raw.split('/').pop()!;
    const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const p = await ctx.newPage();
    await p.goto(`/invite/${token}`);
    await expect(p.getByText('This is a private event')).toBeVisible();
    await expect(p.getByText('Private details')).toHaveCount(0);
    await ctx.close();
  });
});