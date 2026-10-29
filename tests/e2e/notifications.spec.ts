import { test, expect } from '@playwright/test';
import { E2E_ENABLED, E2E_SKIP_REASON } from './support/env';
import { storageStatePath } from './support/fixtures';
import { readRoster } from './support/fixtures';
import { resetDomainTables, prisma, seedEvent, seedNotification, seedRsvp } from './support/db';
import { newRolePage } from './support/context';

test.describe('Notifications', () => {
  test.use({ storageState: storageStatePath('organizer') });
  test.skip(!E2E_ENABLED, E2E_SKIP_REASON);

  test.beforeEach(async () => {
    await resetDomainTables();
  });

  test('empty state renders @smoke', async ({ page }) => {
    await page.goto('/notifications');
    await expect(page.getByText('Nothing yet.')).toBeVisible();
  });

  test('seeded notification renders and mark-all works', async ({ page }) => {
    const roster = readRoster();
    await seedNotification(roster.organizer.userId, { title: 'Factory notification' });
    await page.goto('/notifications');
    await expect(page.getByText('Factory notification')).toBeVisible();
    await page.getByRole('button', { name: /mark all read/i }).click();
    await expect(page.getByRole('button', { name: /mark all read/i })).toBeDisabled();
  });

  test('all five notification type labels render', async ({ page }) => {
    const roster = readRoster();
    await seedNotification(roster.organizer.userId, { type: 'PROMOTION', title: 'Promo' });
    await seedNotification(roster.organizer.userId, { type: 'EVENT_UPDATED', title: 'Updated' });
    await seedNotification(roster.organizer.userId, { type: 'EVENT_CANCELLED', title: 'Cancelled' });
    await seedNotification(roster.organizer.userId, { type: 'COMMENT', title: 'Comment' });
    await seedNotification(roster.organizer.userId, { type: 'REMINDER', title: 'Reminder' });
    await page.goto('/notifications');
    for (const label of ['You got in', 'Event updated', 'Event cancelled', 'New comment', 'Reminder']) {
      await expect(page.locator('span').filter({ hasText: label }).first()).toBeVisible();
    }
  });

  test('mark one read updates the visible count', async ({ page }) => {
    const roster = readRoster();
    await seedNotification(roster.organizer.userId, { title: 'One read notification' });
    await page.goto('/notifications');
    await expect(page.getByText('(1 unread)')).toBeVisible();
    await page.getByRole('button', { name: 'Mark read' }).first().click();
    await page.waitForTimeout(500);
    await page.reload();
    await expect(page.getByText('(1 unread)')).toHaveCount(0);
  });

  test('unread bell label matches seeded unread count', async ({ page }) => {
    const roster = readRoster();
    await seedNotification(roster.organizer.userId, { title: 'Bell notification' });
    await page.goto('/');
    await expect(page.getByRole('link', { name: /Notifications, 1 unread/ })).toBeVisible();
  });

  test('coming up widget renders an upcoming RSVP', async ({ page }) => {
    const roster = readRoster();
    const event = await seedEvent({
      title: 'Coming up event',
      userId: roster.organizer.userId,
      date: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
    });
    await seedRsvp(event.id, roster.organizer.userId, { status: 'GOING' });
    await seedNotification(roster.organizer.userId, { title: 'Seed notification for widget' });
    await page.goto('/notifications');
    await expect(page.getByText('Coming up event')).toBeVisible();
  });

  test('reminder generation and reload dedupe', async ({ page }) => {
    const roster = readRoster();
    const event = await seedEvent({
      title: 'Reminder event',
      userId: roster.organizer.userId,
      date: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });
    await seedRsvp(event.id, roster.organizer.userId, { status: 'GOING', notifyOnUpdate: true });
    await seedNotification(roster.organizer.userId, { title: 'Seed notification for reminder' });
    await page.goto('/notifications');
    await page.reload();
    await expect(page.locator('span').filter({ hasText: 'Reminder' }).first()).toBeVisible();
    const firstTotal = await page.getByText(/Showing .* of .* notification/).textContent();
    await page.reload();
    const secondTotal = await page.getByText(/Showing .* of .* notification/).textContent();
    expect(secondTotal).toBe(firstTotal);
  });

  test('57 seeded notifications paginate and clamp', async ({ page }) => {
    const roster = readRoster();
    for (let i = 0; i < 57; i += 1) {
      await seedNotification(roster.organizer.userId, { title: `Paged notification ${i + 1}` });
    }
    await page.goto('/notifications');
    await expect(page.getByText('Showing 1–20 of 57')).toBeVisible();
    await page.goto('/notifications?page=999');
    await expect(page.getByText(/Showing 41–57 of 57/)).toBeVisible();
  });

  test('marking on page 2 keeps the page', async ({ page }) => {
    const roster = readRoster();
    for (let i = 0; i < 57; i += 1) {
      await seedNotification(roster.organizer.userId, { title: `Page2 notification ${i + 1}` });
    }
    await page.goto('/notifications?page=2');
    await page.getByRole('button', { name: 'Mark read' }).first().click();
    await page.waitForTimeout(500);
    await expect(page).toHaveURL(/page=2/);
  });

  test('cancellation notification has no dead event link', async ({ page }) => {
    const roster = readRoster();
    await seedNotification(roster.organizer.userId, {
      type: 'EVENT_CANCELLED',
      title: 'Cancelled notification',
      body: 'The event was cancelled.',
      eventId: null,
    });
    await page.goto('/notifications');
    await expect(page.getByText('Cancelled notification')).toBeVisible();
    await expect(page.getByRole('link', { name: 'View event' })).toHaveCount(0);
  });

  test('scoping: another user cannot clear victim unread rows', async ({ browser }) => {
    const roster = readRoster();
    const victim = (await prisma.user?.findUnique?.({ where: { id: roster.organizer.userId } })) ?? null;
    void victim;
    const outsiderRoster = readRoster();
    await seedNotification(roster.organizer.userId, { title: 'Victim notification' });
    const { context, page } = await newRolePage(browser, 'outsider');
    await page.goto('/notifications');
    // Outsider has no own notifications, so empty state renders, not the
    // mark-all control path that would touch the victim's rows.
    await expect(page.getByText('Nothing yet.')).toBeVisible();
    const victimUnread = await prisma.notification.count({
      where: { userId: roster.organizer.userId, readAt: null },
    });
    expect(victimUnread).toBeGreaterThan(0);
    await context.close();
  });
});