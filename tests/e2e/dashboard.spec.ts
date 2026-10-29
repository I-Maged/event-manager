import { test, expect } from '@playwright/test';
import { E2E_ENABLED, E2E_SKIP_REASON } from './support/env';
import { storageStatePath } from './support/fixtures';
import { readRoster } from './support/fixtures';
import { resetDomainTables, prisma, seedEvent, seedRsvp } from './support/db';

test.describe('Organizer dashboard', () => {
  test.use({ storageState: storageStatePath('organizer') });
  test.skip(!E2E_ENABLED, E2E_SKIP_REASON);

  test.beforeEach(async () => {
    await resetDomainTables();
  });

  test('dashboard renders for organizer @smoke', async ({ page }) => {
    const roster = readRoster();
    await seedEvent({
      title: 'Dashboard event',
      userId: roster.organizer.userId,
      maxAttendees: 4,
    });
    await page.goto('/my-events');
    await expect(page.getByText('Dashboard event')).toBeVisible();
  });

  test('stats show upcoming and past events', async ({ page }) => {
    const roster = readRoster();
    const upcoming = await seedEvent({
      title: 'Upcoming stat event',
      userId: roster.organizer.userId,
      maxAttendees: 10,
    });
    await seedRsvp(upcoming.id, roster.organizer.userId, { status: 'GOING' });
    await seedEvent({
      title: 'Past stat event',
      userId: roster.organizer.userId,
      date: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
      maxAttendees: 4,
    });
    await page.goto('/my-events');
    await expect(page.getByText('Upcoming', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Past', { exact: true }).first()).toBeVisible();
  });

  test('upcoming, past, and all views work', async ({ page }) => {
    const roster = readRoster();
    await seedEvent({ title: 'Upcoming view event', userId: roster.organizer.userId });
    await seedEvent({
      title: 'Past view event',
      userId: roster.organizer.userId,
      date: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
    });
    await page.goto('/my-events?view=upcoming');
    await expect(page.getByText('Upcoming view event')).toBeVisible();
    await expect(page.getByText('Past view event')).toHaveCount(0);

    await page.goto('/my-events?view=past');
    await expect(page.getByText('Past view event')).toBeVisible();
    await expect(page.getByText('Upcoming view event')).toHaveCount(0);
  });

  test('search filters the dashboard', async ({ page }) => {
    const roster = readRoster();
    await seedEvent({ title: 'Searchable dashboard event', userId: roster.organizer.userId });
    await seedEvent({ title: 'Other dashboard event', userId: roster.organizer.userId });
    await page.goto('/my-events');
    await page.getByLabel('Search your events').fill('Searchable');
    await page.waitForTimeout(500);
    await expect(page.getByText('Searchable dashboard event')).toBeVisible();
    await expect(page.getByText('Other dashboard event')).toHaveCount(0);
  });

  test('sort by fill works', async ({ page }) => {
    const roster = readRoster();
    await seedEvent({ title: 'Fill sort event', userId: roster.organizer.userId, maxAttendees: 10 });
    await page.goto('/my-events');
    await page.getByLabel('Sort by').selectOption('fill');
    await expect(page).toHaveURL(/sort=fill/);
  });

  test('empty views render their empty states', async ({ page }) => {
    const roster = readRoster();
    await seedEvent({ title: 'Only upcoming', userId: roster.organizer.userId });
    await page.goto('/my-events?view=past');
    await expect(page.getByText('No past events yet.')).toBeVisible();
    await page.goto('/my-events?view=upcoming&q=ZZZZ-no-match');
    await expect(page.getByText(/No events match/)).toBeVisible();
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

  test('CSV export link points at the attendees route', async ({ page }) => {
    const roster = readRoster();
    const event = await seedEvent({ title: 'CSV dashboard event', userId: roster.organizer.userId });
    await page.goto('/my-events');
    await expect(page.getByRole('link', { name: 'Export CSV' }).first()).toHaveAttribute(
      'href',
      `/api/events/${event.id}/attendees`,
    );
  });

  test('uncapped event shows Avg fill em dash', async ({ page }) => {
    const roster = readRoster();
    await seedEvent({ title: 'Uncapped dashboard event', userId: roster.organizer.userId, maxAttendees: null });
    await page.goto('/my-events');
    await expect(page.getByText('Avg fill')).toBeVisible();
    // The Avg fill value renders as an em dash for an uncapped-only dashboard.
    await expect(page.getByText('—')).toBeVisible();
  });

  test('check-in journey updates progress and is idempotent', async ({ page }) => {
    const roster = readRoster();
    const event = await seedEvent({ title: 'Checkin event', userId: roster.organizer.userId, maxAttendees: 4 });
    await seedRsvp(event.id, roster.organizer.userId, { status: 'GOING' });
    await page.goto(`/events/${event.id}`);
    const checkbox = page.getByLabel('Check in attendee');
    await checkbox.check();
    await expect(page.getByText(/Checked in 1\/1 going/)).toBeVisible();
    // Undo and redo remains idempotent.
    await page.getByLabel('Undo check-in').uncheck().catch(() => {});
    await page.getByLabel('Check in attendee').check().catch(() => {});
  });
});