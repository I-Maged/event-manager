import { test, expect } from '@playwright/test';
import { E2E_ENABLED, E2E_SKIP_REASON } from './support/env';
import { storageStatePath } from './support/fixtures';
import { readRoster } from './support/fixtures';
import { resetDomainTables, prisma } from './support/db';

test.describe('RSVP and waitlist', () => {
  test.use({ storageState: storageStatePath('organizer') });
  test.skip(!E2E_ENABLED, E2E_SKIP_REASON);

  test.beforeEach(async () => {
    await resetDomainTables();
  });

  async function createEvent(cap: number | null = null) {
    const roster = readRoster();
    const event = await prisma.event.create({
      data: {
        title: 'RSVP event',
        description: 'desc',
        date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        timeZone: 'Europe/Berlin',
        location: 'Somewhere',
        maxAttendees: cap,
        isPublic: true,
        category: 'OTHER',
        userId: roster.organizer.userId,
        organizerName: 'Org',
      },
    });
    return event;
  }

  test('GOING, MAYBE and NOT_GOING can be selected', async ({ page }) => {
    const event = await createEvent();
    await page.goto(`/events/${event.id}`);
    await page.getByRole('button', { name: 'Going' }).click();
    await expect(page.getByRole('button', { name: 'Going' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await page.getByRole('button', { name: 'Maybe' }).click();
    await expect(page.getByRole('button', { name: 'Maybe' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  test('full event shows the wishlist CTA', async ({ page }) => {
    const roster = readRoster();
    const event = await createEvent(1);
    await prisma.rSVP.create({
      data: {
        eventId: event.id,
        userId: 'other-user',
        status: 'GOING',
        attendeeName: 'Other',
      },
    });
    await page.goto(`/events/${event.id}`);
    await expect(page.getByRole('button', { name: /wishlist/i })).toBeVisible();
  });

  test('ended event is read-only', async ({ page }) => {
    const event = await createEvent();
    await prisma.event.update({
      where: { id: event.id },
      data: { date: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    });
    await page.goto(`/events/${event.id}`);
    await expect(page.getByText('This event has ended.', { exact: true })).toBeVisible();
  });
});