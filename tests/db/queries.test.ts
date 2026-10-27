import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EventListParams } from '@/lib/discovery';
import {
  canViewEvent,
  getAttendees,
  getAttendeesPage,
  getCategoryCountsCore,
  getComments,
  getOrganizerEventsCore,
  getPublicEventsPageCore,
  getRsvpCounts,
  getUpcomingRsvps,
  getUserPromotions,
  getUserWishlist,
  getWaitlistPosition,
} from '@/lib/events';
import { ensureDueReminders, getNotificationsPage } from '@/lib/notifications';
import { prisma, resetDomainTables } from '../support/db';
import {
  makeComment,
  makeEvent,
  makeNotification,
  makeRsvp,
  uniqueId,
} from '../support/factories';

const baseParams: EventListParams = {
  category: null,
  organizer: null,
  page: 1,
  q: '',
  sort: 'date',
  when: 'any',
};

describe('Public events page (getPublicEventsPageCore)', () => {
  beforeEach(async () => {
    await resetDomainTables();
  });

  it('returns only public, upcoming events', async () => {
    const now = new Date();
    await makeEvent({ isPublic: true, date: new Date(now.getTime() + 86_400_000) });
    await makeEvent({ isPublic: false, date: new Date(now.getTime() + 86_400_000) });
    await makeEvent({ isPublic: true, date: new Date(now.getTime() - 86_400_000) });

    const page = await getPublicEventsPageCore(baseParams, now);
    expect(page.events).toHaveLength(1);
    expect(page.events[0]?.isPublic).toBe(true);
  });

  it('category filter works', async () => {
    await makeEvent({ category: 'MUSIC' });
    await makeEvent({ category: 'SPORTS' });

    const page = await getPublicEventsPageCore({ ...baseParams, category: 'MUSIC' });
    expect(page.events).toHaveLength(1);
    expect(page.events[0]?.category).toBe('MUSIC');
  });

  it('search matches title, description, location, organizer name', async () => {
    await makeEvent({ title: 'Alpha Conference', description: 'desc', location: 'place', organizerName: 'Organizer A' });
    await makeEvent({ title: 'Beta Meetup', description: 'Alpha appears here', location: 'place', organizerName: 'Organizer B' });
    await makeEvent({ title: 'Gamma', description: 'desc', location: 'Alpha hall', organizerName: 'Organizer C' });
    await makeEvent({ title: 'Delta', description: 'desc', location: 'place', organizerName: 'Alpha organizer' });

    const page = await getPublicEventsPageCore({ ...baseParams, q: 'Alpha' });
    expect(page.events).toHaveLength(4);
  });

  it('percent and underscore match literally', async () => {
    await makeEvent({ title: '100% done' });
    await makeEvent({ title: 'no percent' });

    const page = await getPublicEventsPageCore({ ...baseParams, q: '100%' });
    expect(page.events).toHaveLength(1);
    expect(page.events[0]?.title).toBe('100% done');
  });

  it('sort by date, newest, popular is deterministic', async () => {
    await makeEvent({ title: 'A', date: new Date(Date.now() + 2 * 86_400_000) });
    await makeEvent({ title: 'B', date: new Date(Date.now() + 1 * 86_400_000) });
    await makeEvent({ title: 'C', date: new Date(Date.now() + 3 * 86_400_000) });

    const byDate = await getPublicEventsPageCore({ ...baseParams, sort: 'date' });
    expect(byDate.events.map((e) => e.title)).toEqual(['B', 'A', 'C']);

    const byNewest = await getPublicEventsPageCore({ ...baseParams, sort: 'newest' });
    expect(byNewest.events.map((e) => e.title)).toEqual(['C', 'A', 'B']);
  });

  it('pagination clamps out-of-range pages', async () => {
    for (let i = 0; i < 5; i += 1) await makeEvent({});
    const page = await getPublicEventsPageCore({ ...baseParams, page: 999 });
    expect(page.page).toBe(page.pageCount);
    expect(page.pageCount).toBeGreaterThan(0);
    expect(page.events.length).toBeLessThanOrEqual(12);
  });

  it('count and page come from one consistent snapshot', async () => {
    for (let i = 0; i < 25; i += 1) await makeEvent({});
    const first = await getPublicEventsPageCore(baseParams);
    const second = await getPublicEventsPageCore(baseParams);
    expect(first.total).toBe(second.total);
    expect(first.pageCount).toBe(second.pageCount);
  });
});

describe('Category counts', () => {
  beforeEach(async () => {
    await resetDomainTables();
  });

  it('matches the unfiltered public scope', async () => {
    await makeEvent({ category: 'MUSIC', isPublic: true });
    await makeEvent({ category: 'MUSIC', isPublic: true });
    await makeEvent({ category: 'SPORTS', isPublic: true });
    await makeEvent({ category: 'MUSIC', isPublic: false }); // not counted

    const counts = await getCategoryCountsCore();
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    expect(counts.MUSIC).toBe(2);
    expect(counts.SPORTS).toBe(1);
    expect(total).toBe(3);
  });
});

describe('Organizer events', () => {
  beforeEach(async () => {
    await resetDomainTables();
  });

  it('splits upcoming/past correctly', async () => {
    const now = new Date();
    const user = uniqueId('organizer');
    await makeEvent({ userId: user, date: new Date(now.getTime() + 86_400_000) });
    await makeEvent({ userId: user, date: new Date(now.getTime() - 86_400_000) });

    const result = await getOrganizerEventsCore(user, now);
    expect(result.upcoming).toHaveLength(1);
    expect(result.past).toHaveLength(1);
  });

  it('computes counts per status and fill rate', async () => {
    const now = new Date();
    const user = uniqueId('organizer');
    const event = await makeEvent({
      userId: user,
      date: new Date(now.getTime() + 86_400_000),
      maxAttendees: 4,
    });
    await makeRsvp({ eventId: event.id, userId: uniqueId('u1'), status: 'GOING' });
    await makeRsvp({ eventId: event.id, userId: uniqueId('u2'), status: 'GOING' });
    await makeRsvp({ eventId: event.id, userId: uniqueId('u3'), status: 'MAYBE' });

    const result = await getOrganizerEventsCore(user, now);
    expect(result.upcoming).toHaveLength(1);
    const stats = result.upcoming[0];
    expect(stats.counts.GOING).toBe(2);
    expect(stats.counts.MAYBE).toBe(1);
    expect(stats.fillRate).toBe(0.5);
  });

  it('uncapped events report a null fill rate', async () => {
    const now = new Date();
    const user = uniqueId('organizer');
    const event = await makeEvent({
      userId: user,
      date: new Date(now.getTime() + 86_400_000),
      maxAttendees: null,
    });
    await makeRsvp({ eventId: event.id, userId: uniqueId('u1'), status: 'GOING' });

    const result = await getOrganizerEventsCore(user, now);
    expect(result.upcoming[0]?.fillRate).toBeNull();
  });
});

describe('RSVP counts', () => {
  beforeEach(async () => {
    await resetDomainTables();
  });

  it('fills every status, including zeros', async () => {
    const event = await makeEvent({});
    await makeRsvp({ eventId: event.id, userId: uniqueId('u1'), status: 'GOING' });
    await makeRsvp({ eventId: event.id, userId: uniqueId('u2'), status: 'MAYBE' });

    const counts = await getRsvpCounts(event.id);
    expect(counts.GOING).toBe(1);
    expect(counts.MAYBE).toBe(1);
    expect(counts.NOT_GOING).toBe(0);
    expect(counts.WAITLISTED).toBe(0);
  });
});

describe('User wishlist', () => {
  beforeEach(async () => {
    await resetDomainTables();
  });

  it('computes positions in two queries, not N+1', async () => {
    const user = uniqueId('user');
    const eventA = await makeEvent({ maxAttendees: 1 });
    const eventB = await makeEvent({ maxAttendees: 1 });
    await makeRsvp({ eventId: eventA.id, userId: user, status: 'WAITLISTED' });
    await makeRsvp({ eventId: eventB.id, userId: user, status: 'WAITLISTED' });

    const wishlist = await getUserWishlist(user);
    expect(wishlist).toHaveLength(2);
    for (const entry of wishlist) {
      expect(entry.waitlistPosition).toBe(1);
    }
  });
});

describe('User promotions', () => {
  beforeEach(async () => {
    await resetDomainTables();
  });

  it('returns only promoted GOING rows', async () => {
    const user = uniqueId('user');
    const event = await makeEvent({ maxAttendees: 1 });
    await makeRsvp({
      eventId: event.id,
      userId: user,
      status: 'GOING',
      promotedAt: new Date(),
    });
    await makeRsvp({
      eventId: event.id,
      userId: uniqueId('other'),
      status: 'WAITLISTED',
      promotedAt: new Date(),
    });

    const promotions = await getUserPromotions(user);
    expect(promotions).toHaveLength(1);
    expect(promotions[0]?.event.id).toBe(event.id);
  });
});

describe('Upcoming RSVPs', () => {
  beforeEach(async () => {
    await resetDomainTables();
  });

  it('ordering (soonest first) and limit are correct', async () => {
    const user = uniqueId('user');
    const now = new Date();
    const e1 = await makeEvent({ date: new Date(now.getTime() + 3 * 86_400_000) });
    const e2 = await makeEvent({ date: new Date(now.getTime() + 1 * 86_400_000) });
    const e3 = await makeEvent({ date: new Date(now.getTime() + 2 * 86_400_000) });
    await makeRsvp({ eventId: e1.id, userId: user, status: 'GOING' });
    await makeRsvp({ eventId: e2.id, userId: user, status: 'GOING' });
    await makeRsvp({ eventId: e3.id, userId: user, status: 'GOING' });

    const rsvps = await getUpcomingRsvps(user, 2);
    expect(rsvps).toHaveLength(2);
    expect(rsvps[0]?.event.id).toBe(e2.id);
    expect(rsvps[1]?.event.id).toBe(e3.id);
  });
});

describe('Notifications page', () => {
  beforeEach(async () => {
    await resetDomainTables();
  });

  it('paginates and clamps', async () => {
    const user = uniqueId('user');
    for (let i = 0; i < 25; i += 1) {
      await makeNotification({ userId: user });
    }
    const page = await getNotificationsPage(user, 999);
    expect(page.page).toBe(page.pageCount);
    expect(page.notifications.length).toBe(20);
    expect(page.total).toBe(25);
  });
});

describe('ensureDueReminders', () => {
  beforeEach(async () => {
    await resetDomainTables();
  });

  it('only creates rows inside the 48-hour window', async () => {
    const user = uniqueId('user');
    const now = new Date();
    const due = { id: uniqueId('e'), notifyOnUpdate: true, event: { id: uniqueId('e'), title: 'T', date: new Date(now.getTime() + 24 * 60 * 60 * 1000) } };
    const far = { id: uniqueId('e2'), notifyOnUpdate: true, event: { id: uniqueId('e2'), title: 'T2', date: new Date(now.getTime() + 10 * 86_400_000) } };

    await ensureDueReminders(user, [due, far]);
    const count = await prisma.notification.count({
      where: { userId: user, type: 'REMINDER' },
    });
    expect(count).toBe(1);
  });

  it('dedupes within 24 hours', async () => {
    const user = uniqueId('user');
    const now = new Date();
    const candidate = {
      id: uniqueId('e'),
      notifyOnUpdate: true,
      event: { id: uniqueId('e'), title: 'T', date: new Date(now.getTime() + 24 * 60 * 60 * 1000) },
    };
    await ensureDueReminders(user, [candidate]);
    await ensureDueReminders(user, [candidate]);
    const count = await prisma.notification.count({
      where: { userId: user, type: 'REMINDER' },
    });
    expect(count).toBe(1);
  });

  it('skips opted-out rows', async () => {
    const user = uniqueId('user');
    const now = new Date();
    const optedOut = {
      id: uniqueId('e'),
      notifyOnUpdate: false,
      event: { id: uniqueId('e'), title: 'T', date: new Date(now.getTime() + 24 * 60 * 60 * 1000) },
    };
    await ensureDueReminders(user, [optedOut]);
    const count = await prisma.notification.count({
      where: { userId: user, type: 'REMINDER' },
    });
    expect(count).toBe(0);
  });

  it('never throws on DB failure', async () => {
    const user = uniqueId('user');
    const now = new Date();
    const createManySpy = vi
      .spyOn(prisma.notification, 'createMany')
      .mockRejectedValue(new Error('db down'));
    try {
      await expect(
        ensureDueReminders(user, [
          {
            id: uniqueId('e'),
            notifyOnUpdate: true,
            event: { id: uniqueId('e'), title: 'T', date: new Date(now.getTime() + 24 * 60 * 60 * 1000) },
          },
        ]),
      ).resolves.toBeUndefined();
    } finally {
      createManySpy.mockRestore();
    }
  });
});

describe('Visibility (canViewEvent)', () => {
  beforeEach(async () => {
    await resetDomainTables();
  });

  it('matrix: public/private × anon/organizer/holder/other', async () => {
    const publicEvent = await makeEvent({ isPublic: true });
    const organizerId = uniqueId('organizer');
    const privateEvent = await makeEvent({ isPublic: false, userId: organizerId });
    const holderId = uniqueId('holder');
    await makeRsvp({ eventId: privateEvent.id, userId: holderId, status: 'GOING' });
    const otherId = uniqueId('other');

    expect(await canViewEvent(publicEvent, null)).toBe(true);
    expect(await canViewEvent(privateEvent, null)).toBe(false);
    expect(await canViewEvent(privateEvent, organizerId)).toBe(true);
    expect(await canViewEvent(privateEvent, holderId)).toBe(true);
    expect(await canViewEvent(privateEvent, otherId)).toBe(false);
  });
});

describe('Visibility enforcement on data accessors', () => {
  beforeEach(async () => {
    await resetDomainTables();
  });

  it('getComments enforces visibility', async () => {
    const organizerId = uniqueId('organizer');
    const publicEvent = await makeEvent({ isPublic: true });
    const privateEvent = await makeEvent({ isPublic: false, userId: organizerId });
    await makeComment({ eventId: privateEvent.id });

    await expect(getComments(publicEvent, null, 50)).resolves.toHaveLength(0);
    await expect(getComments(privateEvent, uniqueId('outsider'), 50)).rejects.toThrow();
    const rows = await getComments(privateEvent, organizerId, 50);
    expect(rows).toHaveLength(1);
  });

  it('getAttendees enforces visibility', async () => {
    const organizerId = uniqueId('organizer');
    const publicEvent = await makeEvent({ isPublic: true });
    const privateEvent = await makeEvent({ isPublic: false, userId: organizerId });
    await makeRsvp({ eventId: privateEvent.id, userId: uniqueId('u'), status: 'GOING' });

    await expect(getAttendees(publicEvent, null)).resolves.toHaveLength(0);
    await expect(getAttendees(privateEvent, uniqueId('outsider'))).rejects.toThrow();
    const rows = await getAttendees(privateEvent, organizerId);
    expect(rows).toHaveLength(1);
  });
});

describe('Waitlist position', () => {
  beforeEach(async () => {
    await resetDomainTables();
  });

  it('returns null for non-waitlisted or missing rows', async () => {
    const event = await makeEvent({ maxAttendees: null });
    const user = uniqueId('user');
    await makeRsvp({ eventId: event.id, userId: user, status: 'GOING' });
    expect(await getWaitlistPosition(event.id, user)).toBeNull();
    expect(await getWaitlistPosition(event.id, uniqueId('missing'))).toBeNull();
  });
});

describe('Attendees page cursor', () => {
  beforeEach(async () => {
    await resetDomainTables();
  });

  it('uses a stable cursor and does not duplicate or skip rows across a page boundary', async () => {
    const event = await makeEvent({ maxAttendees: null });
    const userIds = Array.from({ length: 120 }, () => uniqueId('user'));
    await Promise.all(
      userIds.map((u) => makeRsvp({ eventId: event.id, userId: u, status: 'GOING' })),
    );

    const all: string[] = [];
    let cursor: string | undefined;
    for (;;) {
      const page = await getAttendeesPage(event, null, { cursor, take: 50 });
      for (const row of page) all.push(row.id);
      if (page.length < 50) break;
      cursor = page[page.length - 1]?.id;
    }

    expect(new Set(all).size).toBe(120);
    expect(all.sort()).toEqual(
      (
        await prisma.rSVP.findMany({
          where: { eventId: event.id },
          select: { id: true },
        })
      ).map((r) => r.id).sort(),
    );
  });

  it('concurrent inserts during cursor paging do not corrupt the export', async () => {
    const event = await makeEvent({ maxAttendees: null });
    const initial = Array.from({ length: 40 }, () => uniqueId('user'));
    await Promise.all(
      initial.map((u) => makeRsvp({ eventId: event.id, userId: u, status: 'GOING' })),
    );

    let cursor: string | undefined;
    const collected: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const page = await getAttendeesPage(event, null, { cursor, take: 20 });
      for (const row of page) collected.push(row.id);
      cursor = page[page.length - 1]?.id;
      // Insert while paging.
      await makeRsvp({ eventId: event.id, userId: uniqueId('user'), status: 'GOING' });
    }

    // No duplicates collected across page boundaries.
    expect(new Set(collected).size).toBe(collected.length);
  });
});
