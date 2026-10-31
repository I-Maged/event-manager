import { test, expect } from '@playwright/test';
import { E2E_ENABLED, E2E_SKIP_REASON } from './support/env';
import { storageStatePath } from './support/fixtures';
import { readRoster } from './support/fixtures';
import { resetDomainTables, prisma, seedEvent, seedNotification, seedRsvp } from './support/db';
import { newRolePage } from './support/context';

test.describe('Security', () => {
  test.use({ storageState: storageStatePath('organizer') });
  test.skip(!E2E_ENABLED, E2E_SKIP_REASON);

  test.beforeEach(async () => {
    await resetDomainTables();
  });

  test('private title is absent for an outsider @smoke', async ({ browser }) => {
    const roster = readRoster();
    const event = await seedEvent({
      title: 'SECRET TITLE',
      isPublic: false,
      userId: roster.organizer.userId,
    });
    const ctx = await browser.newContext({ storageState: storageStatePath('outsider') });
    const page = await ctx.newPage();
    await page.goto(`/events/${event.id}`);
    const html = await page.content();
    expect(html).not.toContain('SECRET TITLE');
    await ctx.close();
  });

  test('stored XSS payload does not execute', async ({ page }) => {
    let triggered = false;
    page.on('dialog', () => {
      triggered = true;
    });
    await page.addInitScript(() => {
      (window as any).__xss = false;
    });
    const roster = readRoster();
    const event = await seedEvent({
      title: '<img src=x onerror=window.__xss=true>',
      userId: roster.organizer.userId,
    });
    await seedComment(event.id, roster.organizer.userId, {
      authorName: '<script>window.__xss=true</script>',
      body: '<img src=x onerror=window.__xss=true>',
    });
    await page.goto(`/events/${event.id}`);
    const xss = await page.evaluate(() => (window as any).__xss === true);
    expect(xss || triggered).toBeFalsy();
  });

  async function seedComment(eventId: string, userId: string, overrides: Record<string, unknown> = {}) {
    await prisma.comment.create({
      data: {
        eventId,
        userId,
        authorName: 'Attacker',
        body: 'Payload',
        ...overrides,
      },
    });
  }

  test('non-organizer cannot edit or delete an event', async ({ browser }) => {
    const roster = readRoster();
    const event = await seedEvent({ title: 'Protected edit event', userId: roster.organizer.userId });

    const ctx = await browser.newContext({ storageState: storageStatePath('outsider') });
    const page = await ctx.newPage();
    await page.goto(`/events/${event.id}/edit`);
    await expect(page).toHaveURL(/\/events(\/)?$/);
    await page.goto(`/events/${event.id}`);
    await expect(page.getByRole('button', { name: 'Delete event' })).toHaveCount(0);
    await ctx.close();
  });

  test('non-organizer cannot check in or export from a public event', async ({ browser }) => {
    const roster = readRoster();
    const event = await seedEvent({ title: 'Checkin permission event', userId: roster.organizer.userId });
    await seedRsvp(event.id, roster.organizer.userId, { status: 'GOING' });

    const ctx = await browser.newContext({ storageState: storageStatePath('attendee') });
    const page = await ctx.newPage();
    await page.goto(`/events/${event.id}`);
    await expect(page.getByRole('checkbox', { name: /Check in attendee|Undo check-in/i })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Export CSV' })).toHaveCount(0);
    await ctx.close();
  });

  test('user cannot read another user’s notifications', async ({ browser }) => {
    const roster = readRoster();
    await seedNotification(roster.organizer.userId, { title: 'Victim private notification' });

    const { context, page } = await newRolePage(browser, 'outsider');
    await page.goto('/notifications');
    await expect(page.getByText('Victim private notification')).toHaveCount(0);
    await context.close();
  });

  test('CSV injection payload is neutralized in the export', async ({ page }) => {
    const roster = readRoster();
    const event = await seedEvent({ title: 'CSV injection event', userId: roster.organizer.userId, maxAttendees: 4 });
    await seedRsvp(event.id, 'csv-injection-user', {
      status: 'GOING',
      attendeeName: '=SUM(A1:A10)',
    });
    await page.goto(`/my-events`);
    const response = await page.request.get(`/api/events/${event.id}/attendees`, {
      headers: { Cookie: (await page.context().cookies()).map((c) => `${c.name}=${c.value}`).join('; ') },
    });
    const body = await response.text();
    expect(body).toContain(`"'=SUM(A1:A10)"`);
  });
});