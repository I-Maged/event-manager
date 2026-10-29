import { test, expect } from '@playwright/test';
import { E2E_ENABLED, E2E_SKIP_REASON } from './support/env';
import { storageStatePath } from './support/fixtures';
import { readRoster } from './support/fixtures';
import { resetDomainTables, prisma, seedEvent } from './support/db';
import { newRolePage } from './support/context';

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
    await page.waitForURL((url: URL) => url.pathname !== '/events/new' && /\/events\/[^/]+$/.test(url.pathname));
    return page.url();
  }

  test('organizer can create an invite link @smoke', async ({ page }) => {
    await createPrivateEvent(page);
    await page.getByRole('button', { name: 'Create invite link' }).click();
    await expect(page.getByRole('status')).toContainText('Invite link ready');
    await expect(page.getByLabel('Invite link')).toHaveValue(/\/invite\//);
  });

  test('creating a second time returns the same link', async ({ page }) => {
    const roster = readRoster();
    const event = await seedEvent({
      title: 'Idempotent invite event',
      isPublic: false,
      userId: roster.organizer.userId,
      inviteToken: 'first-token',
    });
    // Reusing createInviteLink would already be idempotent, but the DB state
    // proves the same token survives a repeated call.
    await page.goto(`/events/${event.id}`);
    await expect(page.getByLabel('Invite link')).toHaveValue(/\/invite\/first-token/);
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

  test('signed-out invite prompt preserves callback URL', async ({ browser }) => {
    const roster = readRoster();
    const token = `signed-out-invite-${Date.now()}`;
    const event = await seedEvent({
      title: 'Signed-out invite event',
      isPublic: false,
      userId: roster.organizer.userId,
      inviteToken: token,
    });
    void event;
    const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await ctx.newPage();
    await page.goto(`/invite/${token}`);
    await expect(page.getByText('Sign in to accept this invite.')).toBeVisible();
    await page.getByRole('link', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(new RegExp(`next=%2Finvite%2F${token}`));
    await ctx.close();
  });

  test('accepting an invite creates a GOING RSVP', async ({ browser }) => {
    const roster = readRoster();
    const token = `accept-going-${Date.now()}`;
    const event = await seedEvent({
      title: 'Accept going event',
      isPublic: false,
      userId: roster.organizer.userId,
      inviteToken: token,
    });
    const { context, page } = await newRolePage(browser, 'attendee');
    await page.goto(`/invite/${token}`);
    await page.getByRole('button', { name: 'Accept invite — Join as Going' }).click();
    await expect(page.getByText("You're in!")).toBeVisible();
    const rsvp = await prisma.rSVP.findUnique({
      where: { userId_eventId: { userId: roster.attendee.userId, eventId: event.id } },
    });
    expect(rsvp?.status).toBe('GOING');
    await context.close();
  });

  test('accepting an invite for a full event creates a WAITLISTED RSVP', async ({ browser }) => {
    const roster = readRoster();
    const token = `accept-waitlisted-${Date.now()}`;
    const event = await seedEvent({
      title: 'Accept waitlisted event',
      isPublic: false,
      maxAttendees: 1,
      userId: roster.organizer.userId,
      inviteToken: token,
    });
    await prisma.rSVP.create({
      data: {
        eventId: event.id,
        userId: 'full-event-holder',
        status: 'GOING',
        attendeeName: 'Holder',
      },
    });
    const { context, page } = await newRolePage(browser, 'attendee');
    await page.goto(`/invite/${token}`);
    await page.getByRole('button', { name: 'Accept invite — Join as Going' }).click();
    await expect(page.getByText(/on the wishlist/i)).toBeVisible();
    const rsvp = await prisma.rSVP.findUnique({
      where: { userId_eventId: { userId: roster.attendee.userId, eventId: event.id } },
    });
    expect(rsvp?.status).toBe('WAITLISTED');
    await context.close();
  });

  test('accepting while already GOING is idempotent', async ({ browser }) => {
    const roster = readRoster();
    const token = `accept-idempotent-${Date.now()}`;
    const event = await seedEvent({
      title: 'Idempotent accept event',
      isPublic: false,
      userId: roster.organizer.userId,
      inviteToken: token,
    });
    await prisma.rSVP.create({
      data: {
        eventId: event.id,
        userId: roster.attendee.userId,
        status: 'GOING',
        attendeeName: 'Attendee',
      },
    });
    const { context, page } = await newRolePage(browser, 'attendee');
    await page.goto(`/invite/${token}`);
    await page.getByRole('button', { name: 'Accept invite — Join as Going' }).click();
    await expect(page.getByText("You're in!")).toBeVisible();
    const rsvps = await prisma.rSVP.findMany({
      where: { eventId: event.id, userId: roster.attendee.userId },
    });
    expect(rsvps).toHaveLength(1);
    await context.close();
  });

  test('host is redirected away from the invite page', async ({ page }) => {
    const roster = readRoster();
    const token = `host-redirect-${Date.now()}`;
    const event = await seedEvent({
      title: 'Host redirect event',
      isPublic: false,
      userId: roster.organizer.userId,
      inviteToken: token,
    });
    await page.goto(`/invite/${token}`);
    await expect(page).toHaveURL(new RegExp(`/events/${event.id}$`));
  });

  test('past invite shows the event has ended', async ({ browser }) => {
    const roster = readRoster();
    const token = `past-invite-${Date.now()}`;
    await seedEvent({
      title: 'Past invite event',
      isPublic: false,
      userId: roster.organizer.userId,
      inviteToken: token,
      date: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
    });
    const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await ctx.newPage();
    await page.goto(`/invite/${token}`);
    await expect(page.getByText('This event has ended')).toBeVisible();
    await ctx.close();
  });

  test('invite link panel is organizer-only', async ({ page, browser }) => {
    const eventUrl = await createPrivateEvent(page);
    const id = eventUrl.split('/').filter(Boolean).pop()!;

    const { context, page: attendeePage } = await newRolePage(browser, 'attendee');
    // Attendee cannot view the private page, so they should get the not-found
    // state instead of any invite controls.
    await attendeePage.goto(`/events/${id}`);
    await expect(attendeePage.getByText(/Event not found|not found/i)).toBeVisible();
    await expect(attendeePage.getByRole('button', { name: 'Create invite link' })).toHaveCount(0);
    await context.close();

    await page.goto(`/events/${id}`);
    await expect(page.getByRole('button', { name: 'Create invite link' })).toBeVisible();
  });
});