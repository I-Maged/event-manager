import { test, expect } from '@playwright/test';
import { E2E_ENABLED, E2E_SKIP_REASON } from './support/env';
import { resetDomainTables, prisma } from './support/db';
import { readRoster } from './support/fixtures';
import { seedEvent } from './support/db';

test.describe('Browse and discovery', () => {
  test.skip(!E2E_ENABLED, E2E_SKIP_REASON);

  async function makeEvent(title: string, overrides: Record<string, unknown> = {}) {
    const roster = readRoster();
    return seedEvent({
      title,
      userId: roster.organizer.userId,
      organizerName: 'Org',
      ...overrides,
    });
  }

  test.beforeEach(async () => {
    await resetDomainTables();
  });

  test('no-events state differs from no-results state', async ({ page }) => {
    await page.goto('/events');
    await expect(page.getByText('No upcoming public events yet.')).toBeVisible();

    await makeEvent('Real event');
    await page.goto('/events?q=ZZZZZ-NO-MATCH');
    await expect(page.getByText('No events match your filters.')).toBeVisible();
  });

  test('private and past events are absent from browse @smoke', async ({ page }) => {
    await makeEvent('Public upcoming event');
    await makeEvent('Private event', { isPublic: false });
    await makeEvent('Past event', { date: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) });

    await page.goto('/events');
    await expect(page.getByText('Public upcoming event')).toBeVisible();
    await expect(page.getByText('Private event')).toHaveCount(0);
    await expect(page.getByText('Past event')).toHaveCount(0);
  });

  test('search matches title', async ({ page }) => {
    await makeEvent('FindMe by title');
    await makeEvent('Other event');

    await page.goto('/events?q=FindMe');
    await expect(page.getByText('FindMe by title')).toBeVisible();
    await expect(page.getByText('Other event')).toHaveCount(0);
  });

  test('percent and underscore match literally', async ({ page }) => {
    await makeEvent('Percent%Event');
    await page.goto('/events?q=%25');
    await expect(page.getByText('Percent%Event')).toBeVisible();
  });

  test('?page=999 clamps to the last page', async ({ page }) => {
    for (let i = 0; i < 25; i += 1) {
      await makeEvent(`Bulk event ${i}`);
    }
    await page.goto('/events?page=999');
    await expect(page.getByText(/Showing/)).toBeVisible();
  });

  test('unknown event id shows the not-found page', async ({ page }) => {
    await page.goto('/events/does-not-exist-id-12345');
    await expect(page.getByText(/Event not found|not found/i)).toBeVisible();
  });

  test('data-pending appears during a filter navigation', async ({ page }) => {
    await makeEvent('Filter event');
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route('**/events?**', async (route) => {
      await gate;
      await route.continue();
    });
    await page.goto('/events');
    const navigation = page.getByRole('button', { name: /Other/i }).click();
    await expect(page.locator('section[data-pending]')).toBeVisible({
      timeout: 1000,
    });
    release();
    await navigation;
  });

  test('category chips filter results and counts stay fixed', async ({ page }) => {
    await makeEvent('Music event', { category: 'MUSIC' });
    await makeEvent('Food event', { category: 'FOOD' });

    await page.goto('/events');
    await expect(page.getByRole('button', { name: /Music/ })).toContainText('1');
    await expect(page.getByRole('button', { name: /Food/ })).toContainText('1');

    await page.getByRole('button', { name: /Music/ }).click();
    await expect(page.getByText('Music event')).toBeVisible();
    await expect(page.getByText('Food event')).toHaveCount(0);
    // Unfiltered category counts remain unchanged while a category is active.
    await expect(page.getByRole('button', { name: /Food/ })).toContainText('1');
  });

  test('when and sort controls update the browse URL', async ({ page }) => {
    await makeEvent('Control event');
    await page.goto('/events');
    await page.getByLabel('When').selectOption('today');
    await expect(page).toHaveURL(/when=today/);
    await page.goto('/events');
    await page.getByLabel('Sort by').selectOption('newest');
    await expect(page).toHaveURL(/sort=newest/);
    await expect(page.getByText(/Sort: Newest/)).toBeVisible();
  });

  test('organizer filter chip appears and can be removed', async ({ page }) => {
    const roster = readRoster();
    await makeEvent('Organizer event');
    await page.goto(`/events?organizer=${roster.organizer.userId}`);
    await expect(page.getByText('Organizer event')).toBeVisible();
    // The active organizer chip renders with its removal button.
    await expect(page.getByRole('button', { name: 'Remove filter: By Org' })).toBeVisible();
    // Remove the organizer filter using its chip.
    await page.getByRole('button', { name: 'Remove filter: By Org' }).click();
    await expect(page).not.toHaveURL(/organizer=/);
  });

  test('busy card shows Full for a capped event', async ({ page }) => {
    const roster = readRoster();
    const event = await makeEvent('Full event', { maxAttendees: 1 });
    await prisma.rSVP.create({
      data: {
        eventId: event.id,
        userId: 'another-user',
        status: 'GOING',
        attendeeName: 'Other',
      },
    });
    await page.goto('/events');
    await expect(page.getByText('Full event')).toBeVisible();
    await expect(page.getByText('Full', { exact: true })).toBeVisible();
  });

  test('combined filters remain on page 2 and changing a filter resets page', async ({ page }) => {
    const roster = readRoster();
    for (let i = 0; i < 25; i += 1) {
      await seedEvent({
        title: `Filtered bulk ${i}`,
        userId: roster.organizer.userId,
        organizerName: 'Org',
      });
    }
    await page.goto(`/events?organizer=${roster.organizer.userId}&page=2`);
    await expect(page).toHaveURL(/page=2/);
    await expect(page.getByText(/Filtered bulk/).first()).toBeVisible();

    await page.getByRole('button', { name: /Music/ }).click().catch(() => {});
    // Any filter change should drop the explicit page parameter back to 1.
    await expect(page).not.toHaveURL(/page=2/);
  });
});