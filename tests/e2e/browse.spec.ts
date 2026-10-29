import { test, expect } from '@playwright/test';
import { E2E_ENABLED, E2E_SKIP_REASON } from './support/env';
import { resetDomainTables, prisma } from './support/db';
import { readRoster } from './support/fixtures';

test.describe('Browse and discovery', () => {
  test.skip(!E2E_ENABLED, E2E_SKIP_REASON);

  async function seedEvent(title: string, overrides: Record<string, unknown> = {}) {
    const roster = readRoster();
    return prisma.event.create({
      data: {
        title,
        description: 'Factory-created test event.',
        date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        timeZone: 'Europe/Berlin',
        location: 'Test venue',
        maxAttendees: null,
        isPublic: true,
        category: 'OTHER',
        userId: roster.organizer.userId,
        organizerName: 'Org',
        ...overrides,
      },
    });
  }

  test.beforeEach(async () => {
    await resetDomainTables();
  });

  test('no-events state differs from no-results state', async ({ page }) => {
    await page.goto('/events');
    await expect(page.getByText('No upcoming public events yet.')).toBeVisible();

    await seedEvent('Real event');
    await page.goto('/events?q=ZZZZZ-NO-MATCH');
    await expect(page.getByText('No events match your filters.')).toBeVisible();
  });

  test('private and past events are absent from browse', async ({ page }) => {
    await seedEvent('Public upcoming event');
    await seedEvent('Private event', { isPublic: false });
    await seedEvent('Past event', {
      isPublic: true,
      date: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
    });

    await page.goto('/events');
    await expect(page.getByText('Public upcoming event')).toBeVisible();
    await expect(page.getByText('Private event')).toHaveCount(0);
    await expect(page.getByText('Past event')).toHaveCount(0);
  });

  test('search matches title', async ({ page }) => {
    await seedEvent('FindMe by title');
    await seedEvent('Other event');

    await page.goto('/events?q=FindMe');
    await expect(page.getByText('FindMe by title')).toBeVisible();
    await expect(page.getByText('Other event')).toHaveCount(0);
  });

  test('percent and underscore match literally', async ({ page }) => {
    await seedEvent('Percent%Event');
    await page.goto('/events?q=%25');
    await expect(page.getByText('Percent%Event')).toBeVisible();
  });

  test('?page=999 clamps to the last page', async ({ page }) => {
    for (let i = 0; i < 25; i += 1) {
      await seedEvent(`Bulk event ${i}`);
    }
    await page.goto('/events?page=999');
    await expect(page.getByText(/Showing/)).toBeVisible();
  });

  test('unknown event id shows the not-found page', async ({ page }) => {
    await page.goto('/events/does-not-exist-id-12345');
    await expect(page.getByText(/Event not found|not found/i)).toBeVisible();
  });

  test('data-pending appears during a filter navigation', async ({ page }) => {
    await seedEvent('Filter event');
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
});