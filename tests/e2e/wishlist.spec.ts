import { test, expect } from '@playwright/test';
import { E2E_ENABLED, E2E_SKIP_REASON } from './support/env';
import { storageStatePath } from './support/fixtures';
import { readRoster } from './support/fixtures';
import { resetDomainTables, prisma, seedEvent, seedRsvp } from './support/db';

test.describe('Wishlist', () => {
  test.use({ storageState: storageStatePath('organizer') });
  test.skip(!E2E_ENABLED, E2E_SKIP_REASON);

  test.beforeEach(async () => {
    await resetDomainTables();
  });

  test('empty state renders', async ({ page }) => {
    await page.goto('/wishlist');
    await expect(page.getByText('Your wishlist is empty')).toBeVisible();
  });

  test('positions render for waitlisted entries', async ({ page }) => {
    const roster = readRoster();
    const event = await seedEvent({
      title: 'Wishlist event',
      maxAttendees: 1,
      userId: roster.organizer.userId,
    });
    await seedRsvp(event.id, roster.organizer.userId, { status: 'WAITLISTED' });
    await page.goto('/wishlist');
    await expect(page.getByText('#1 on wishlist')).toBeVisible();
  });

  test('#2 position renders when someone is ahead', async ({ page }) => {
    const roster = readRoster();
    const event = await seedEvent({
      title: 'Wishlist position event',
      maxAttendees: 1,
      userId: roster.organizer.userId,
    });
    await seedRsvp(event.id, 'ahead-user', {
      status: 'WAITLISTED',
      createdAt: new Date(Date.now() - 60_000),
      attendeeName: 'Ahead User',
    });
    await seedRsvp(event.id, roster.organizer.userId, {
      status: 'WAITLISTED',
      createdAt: new Date(),
    });
    await page.goto('/wishlist');
    await expect(page.getByText('#2 on wishlist')).toBeVisible();
  });

  test('leave wishlist asks for confirmation and works when accepted', async ({ page }) => {
    const roster = readRoster();
    const event = await seedEvent({
      title: 'Leave wishlist event',
      maxAttendees: 1,
      userId: roster.organizer.userId,
    });
    await seedRsvp(event.id, roster.organizer.userId, { status: 'WAITLISTED' });

    await page.goto('/wishlist');
    page.on('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: 'Leave wishlist' }).click();
    await page.waitForTimeout(2000);
    await page.reload();
    await expect(page.getByText('Your wishlist is empty')).toBeVisible();
  });

  test('leave wishlist does nothing when confirmation is declined', async ({ page }) => {
    const roster = readRoster();
    const event = await seedEvent({
      title: 'Leave decline event',
      maxAttendees: 1,
      userId: roster.organizer.userId,
    });
    await seedRsvp(event.id, roster.organizer.userId, { status: 'WAITLISTED' });

    await page.goto('/wishlist');
    page.on('dialog', (dialog) => dialog.dismiss());
    await page.getByRole('button', { name: 'Leave wishlist' }).click();
    await expect(page.getByText('#1 on wishlist')).toBeVisible();
  });

  test('promoted section renders, dismisses, and stays dismissed', async ({ page }) => {
    const roster = readRoster();
    const event = await seedEvent({
      title: 'Promoted event',
      maxAttendees: 1,
      userId: roster.organizer.userId,
    });
    await seedRsvp(event.id, roster.organizer.userId, {
      status: 'GOING',
      promotedAt: new Date(),
      attendeeName: 'Org',
    });

    await page.goto('/wishlist');
    await expect(page.getByRole('heading', { name: 'You got in!' })).toBeVisible();
    await expect(page.getByText('Promoted event')).toBeVisible();

    await page.getByRole('button', { name: 'Dismiss' }).click();
    await expect(page.getByRole('heading', { name: 'You got in!' })).toHaveCount(0);

    await page.reload();
    await expect(page.getByRole('heading', { name: 'You got in!' })).toHaveCount(0);
  });

  test('ended wishlist entry shows Event ended instead of leave', async ({ page }) => {
    const roster = readRoster();
    const event = await seedEvent({
      title: 'Ended wishlist event',
      maxAttendees: 1,
      userId: roster.organizer.userId,
      date: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
    });
    await seedRsvp(event.id, roster.organizer.userId, { status: 'WAITLISTED' });

    await page.goto('/wishlist');
    await expect(page.getByText('Event ended')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Leave wishlist' })).toHaveCount(0);
  });

  test('position updates when someone ahead leaves', async ({ page }) => {
    const roster = readRoster();
    const event = await seedEvent({
      title: 'Position update event',
      maxAttendees: 1,
      userId: roster.organizer.userId,
    });
    const ahead = await seedRsvp(event.id, 'ahead-user', {
      status: 'WAITLISTED',
      createdAt: new Date(Date.now() - 60_000),
      attendeeName: 'Ahead User',
    });
    await seedRsvp(event.id, roster.organizer.userId, {
      status: 'WAITLISTED',
      createdAt: new Date(),
    });

    await page.goto('/wishlist');
    await expect(page.getByText('#2 on wishlist')).toBeVisible();

    await prisma.rSVP.delete({ where: { id: ahead.id } });
    await page.reload();
    await expect(page.getByText('#1 on wishlist')).toBeVisible();
  });
});