import { test, expect } from '@playwright/test';
import { E2E_ENABLED, E2E_SKIP_REASON } from './support/env';
import { storageStatePath } from './support/fixtures';
import { readRoster } from './support/fixtures';
import { resetDomainTables, prisma, seedEvent, seedRsvp } from './support/db';

test.describe('Events', () => {
  test.use({ storageState: storageStatePath('organizer') });
  test.skip(!E2E_ENABLED, E2E_SKIP_REASON);

  test.beforeEach(async () => {
    await resetDomainTables();
  });

  function futureLocal(days = 7) {
    const d = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    return d.toISOString().slice(0, 16);
  }

  async function createEvent(page: any, overrides: Record<string, string> = {}) {
    await page.goto('/events/new');
    await page.getByLabel('Title').fill(overrides.title ?? 'Created event');
    await page.getByLabel('Description').fill('Description text');
    await page.getByLabel('Date and time').fill(futureLocal());
    await page.getByLabel('Location').fill('Test venue');
    if (overrides.capacity) await page.getByLabel('Capacity').fill(overrides.capacity);
    if (overrides.category) await page.getByLabel('Category').selectOption(overrides.category);
    if (overrides.isPublic === 'false') {
      await page.getByLabel('Public event (anyone can discover it)').uncheck();
    }
    await page.getByRole('button', { name: 'Create event' }).click();
    await page.waitForURL((url: URL) => url.pathname !== '/events/new' && /\/events\/[^/]+$/.test(url.pathname));
    return page.url();
  }

  test('valid create redirects to the detail page @smoke', async ({ page }) => {
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

  test('signed-out user is redirected from create and edit', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await ctx.newPage();
    await page.goto('/events/new');
    await expect(page).toHaveURL(/\/auth\/sign-in/);
    await ctx.close();
  });

  test('create validation keeps the user on the form', async ({ page }) => {
    await page.goto('/events/new');
    await page.getByRole('button', { name: 'Create event' }).click();
    await expect(page).toHaveURL(/\/events\/new/);
  });

  test('private events render as private after creation', async ({ page }) => {
    await createEvent(page, { title: 'Private created event', isPublic: 'false' });
    await expect(page.getByRole('heading', { name: 'Private created event' })).toBeVisible();
  });

  test('capacity and category persist after creation', async ({ page }) => {
    await createEvent(page, { title: 'Capacity category event', capacity: '25', category: 'MUSIC' });
    await expect(page.getByText(/of 25 spots left/)).toBeVisible();
    await expect(page.getByRole('link', { name: 'Music' })).toBeVisible();
  });

  test('delete cancel keeps the event', async ({ page }) => {
    const url = await createEvent(page, { title: 'Cancel delete event' });
    await page.goto(url + '/edit');
    page.on('dialog', (dialog) => dialog.dismiss());
    await page.getByRole('button', { name: 'Delete event' }).click();
    await expect(page).toHaveURL(/\/edit$/);
    await page.goto(url.replace(/\/edit$/, ''));
    await expect(page.getByRole('heading', { name: 'Cancel delete event' })).toBeVisible();
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

  test('capacity below the GOING count is rejected and values are retained', async ({ page }) => {
    const roster = readRoster();
    const event = await seedEvent({ title: 'Capacity reject event', maxAttendees: 2, userId: roster.organizer.userId });
    await seedRsvp(event.id, 'another-user', { status: 'GOING' });
    await seedRsvp(event.id, 'another-user-2', { status: 'GOING' });

    await page.goto(`/events/${event.id}/edit`);
    await page.getByLabel('Capacity').fill('1');
    await page.getByRole('button', { name: /save|update|create/i }).click();
    await expect(page.locator('.alert-error')).toBeVisible();
    await expect(page.getByLabel('Title')).toHaveValue('Capacity reject event');
  });

  test('event creation rate limit shows an inline error when seeded', async ({ page }) => {
    const roster = readRoster();
    await prisma.rateLimit.create({
      data: { key: `eventCreate:${roster.organizer.userId}`, count: 10, windowStart: new Date() },
    });
    await page.goto('/events/new');
    await page.getByLabel('Title').fill('Rate limited event');
    await page.getByLabel('Description').fill('Description text');
    await page.getByLabel('Date and time').fill(futureLocal());
    await page.getByLabel('Location').fill('Test venue');
    await page.getByRole('button', { name: 'Create event' }).click();
    await expect(page.locator('.alert-error')).toBeVisible();
    await prisma.rateLimit.deleteMany({ where: { key: `eventCreate:${roster.organizer.userId}` } });
  });

  test('title-only edit leaves the date and time field unchanged', async ({ page }) => {
    const url = await createEvent(page, { title: 'Preserve time event' });
    await page.goto(url + '/edit');
    const before = await page.getByLabel('Date and time').inputValue();
    await page.getByLabel('Title').fill('Preserve time event renamed');
    await page.getByRole('button', { name: /save|update|create/i }).click();
    await page.waitForURL(url);
    await page.goto(url + '/edit');
    await expect(page.getByLabel('Date and time')).toHaveValue(before);
  });

  test('title-only edit preserves a legacy null time zone', async ({ page }) => {
    const roster = readRoster();
    const event = await seedEvent({
      title: 'Legacy null zone event',
      timeZone: null,
      userId: roster.organizer.userId,
    });
    await page.goto(`/events/${event.id}/edit`);
    const before = await page.getByLabel('Date and time').inputValue();
    await page.getByLabel('Title').fill('Legacy null zone event renamed');
    await page.getByRole('button', { name: /save|update|create/i }).click();
    await page.waitForURL(`/events/${event.id}`);
    await page.goto(`/events/${event.id}/edit`);
    await expect(page.getByLabel('Date and time')).toHaveValue(before);
  });
});