import { test, expect } from '@playwright/test';
import { E2E_ENABLED, E2E_SKIP_REASON } from './support/env';
import { storageStatePath } from './support/fixtures';
import { readRoster } from './support/fixtures';
import { resetDomainTables, prisma, seedEvent, seedRsvp } from './support/db';
import { newRolePage } from './support/context';

test.describe('RSVP and waitlist', () => {
  test.use({ storageState: storageStatePath('organizer') });
  test.skip(!E2E_ENABLED, E2E_SKIP_REASON);

  test.beforeEach(async () => {
    await resetDomainTables();
  });

  async function createEvent(cap: number | null = null) {
    const roster = readRoster();
    return seedEvent({
      title: 'RSVP event',
      maxAttendees: cap,
      userId: roster.organizer.userId,
      organizerName: 'Org',
    });
  }

  test('GOING, MAYBE and NOT_GOING can be selected @smoke', async ({ page }) => {
    const event = await createEvent();
    await page.goto(`/events/${event.id}`);
    for (const label of ['Going', 'Maybe', "Can't go"]) {
      await page.getByRole('button', { name: new RegExp(`^${label}$`, 'i') }).click();
      await expect(page.getByRole('button', { name: new RegExp(`^${label}$`, 'i') })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
    }
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
    await expect(page.getByRole('button', { name: /Join wishlist/i })).toBeVisible();
  });

  test('joining the wishlist shows the queue position', async ({ page }) => {
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
    await page.getByRole('button', { name: /Join wishlist/i }).click();
    await expect(page.getByText(/on the wishlist/i)).toBeVisible();
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

  test('remove RSVP asks for confirmation and removes it when accepted', async ({ page }) => {
    const event = await createEvent();
    await page.goto(`/events/${event.id}`);
    await page.getByRole('button', { name: 'Going' }).click();
    await expect(page.getByRole('button', { name: 'Going' })).toHaveAttribute('aria-pressed', 'true');

    page.on('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: 'Remove RSVP' }).click();
    await expect(page.getByRole('button', { name: 'Going' })).toHaveAttribute('aria-pressed', 'false');
  });

  test('remove RSVP does nothing when confirmation is declined', async ({ page }) => {
    const event = await createEvent();
    await page.goto(`/events/${event.id}`);
    await page.getByRole('button', { name: 'Going' }).click();

    page.on('dialog', (dialog) => dialog.dismiss());
    await page.getByRole('button', { name: 'Remove RSVP' }).click();
    await expect(page.getByRole('button', { name: 'Going' })).toHaveAttribute('aria-pressed', 'true');
  });

  test('notify toggle persists after reload', async ({ page }) => {
    const event = await createEvent();
    await page.goto(`/events/${event.id}`);
    await page.getByRole('button', { name: 'Going' }).click();
    const checkbox = page.getByRole('checkbox', { name: /Notify me/i });
    await expect(checkbox).toBeChecked();
    await checkbox.uncheck();
    await page.reload();
    await expect(page.getByRole('checkbox', { name: /Notify me/i })).not.toBeChecked();
  });

  test('attendee name appears in the roster', async ({ page }) => {
    const event = await createEvent();
    await page.goto(`/events/${event.id}`);
    await page.getByRole('button', { name: 'Going' }).click();
    // Roster only renders for the organizer, and they are the current user here.
    await expect(page.getByText('E2E Organizer')).toBeVisible();
  });

  test('two-context last-seat RSVP race resolves without overbooking @slow @nightly', async ({ browser }) => {
    const roster = readRoster();
    const event = await seedEvent({
      title: 'Last seat event',
      maxAttendees: 1,
      userId: roster.organizer.userId,
    });

    const org = await newRolePage(browser, 'organizer');
    const att = await newRolePage(browser, 'attendee');
    await org.page.goto(`/events/${event.id}`);
    await att.page.goto(`/events/${event.id}`);

    await Promise.all([
      org.page.getByRole('button', { name: 'Going' }).click(),
      att.page.getByRole('button', { name: 'Going' }).click(),
    ]);
    await org.page.waitForTimeout(1000);
    await att.page.waitForTimeout(1000);

    const rsvps = await prisma.rSVP.findMany({ where: { eventId: event.id } });
    const going = rsvps.filter((r: any) => r.status === 'GOING');
    const waitlisted = rsvps.filter((r: any) => r.status === 'WAITLISTED');
    expect(going.length).toBe(1);
    expect(waitlisted.length).toBe(1);

    await org.context.close();
    await att.context.close();
  });
});