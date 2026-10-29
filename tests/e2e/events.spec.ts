import { test, expect } from '@playwright/test';
import { E2E_ENABLED, E2E_SKIP_REASON } from './support/env';
import { storageStatePath } from './support/fixtures';
import { resetDomainTables } from './support/db';

test.describe('Events', () => {
  test.use({ storageState: storageStatePath('organizer') });
  test.skip(!E2E_ENABLED, E2E_SKIP_REASON);

  test.beforeEach(async () => {
    await resetDomainTables();
  });

  function futureLocal(days = 7) {
    const d = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    // datetime-local uses local browser time; toISOString is UTC, but good enough for valid future.
    return d.toISOString().slice(0, 16);
  }

  test('valid create redirects to the detail page', async ({ page }) => {
    await page.goto('/events/new');
    await page.getByLabel('Title').fill('Created event');
    await page.getByLabel('Description').fill('Description text');
    await page.getByLabel('Date and time').fill(futureLocal());
    await page.getByLabel('Location').fill('Test venue');
    await page.getByRole('button', { name: 'Create event' }).click();
    await page.waitForURL((url) => url.pathname !== '/events/new' && /\/events\/[^/]+$/.test(url.pathname));
    await expect(page.getByRole('heading', { name: 'Created event' })).toBeVisible();
  });

  test('past date shows an inline error', async ({ page }) => {
    await page.goto('/events/new');
    await page.getByLabel('Title').fill('Past event');
    await page.getByLabel('Description').fill('Description text');
    await page.getByLabel('Date and time').fill('2020-01-01T10:00');
    await page.getByLabel('Location').fill('Test venue');
    await page.getByRole('button', { name: 'Create event' }).click();
    await expect(page.locator('.alert-error')).toBeVisible();
  });

  test('non-organizer is redirected from edit page', async ({ browser }) => {
    const context = await browser.newContext({
      storageState: storageStatePath('organizer'),
    });
    const page = await context.newPage();
    await page.goto('/events/new');
    await page.getByLabel('Title').fill('Protected event');
    await page.getByLabel('Description').fill('Description text');
    await page.getByLabel('Date and time').fill(futureLocal());
    await page.getByLabel('Location').fill('Test venue');
    await page.getByRole('button', { name: 'Create event' }).click();
    await page.waitForURL((url) => url.pathname !== '/events/new' && /\/events\/[^/]+$/.test(url.pathname));
    const id = new URL(page.url()).pathname.split('/').filter(Boolean).pop()!;
    await context.close();

    const outsiderContext = await browser.newContext({
      storageState: storageStatePath('outsider'),
    });
    const outsiderPage = await outsiderContext.newPage();
    await outsiderPage.goto(`/events/${id}/edit`);
    await expect(outsiderPage).toHaveURL(/\/events(\/)?$/);
    await outsiderContext.close();
  });

  test('deleting an event asks for confirmation and redirects', async ({ page }) => {
    await page.goto('/events/new');
    await page.getByLabel('Title').fill('To delete');
    await page.getByLabel('Description').fill('Description text');
    await page.getByLabel('Date and time').fill(futureLocal());
    await page.getByLabel('Location').fill('Test venue');
    await page.getByRole('button', { name: 'Create event' }).click();
    await page.waitForURL((url) => url.pathname !== '/events/new' && /\/events\/[^/]+$/.test(url.pathname));

    await page.goto(page.url() + '/edit');
    page.on('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: 'Delete event' }).click({ timeout: 10000 });
    await page.waitForURL(/\/events(\/)?$/);
    await expect(page.getByText('To delete')).toHaveCount(0);
  });
});