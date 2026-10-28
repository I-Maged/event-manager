import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  notifyEventCancelled,
  notifyEventUpdated,
  selectCommentRecipients,
} from '@/lib/event-notifications';
import { notifyUsers } from '@/lib/notifications';
import { notifyPromotions } from '@/lib/rsvp';
import { prisma, resetDomainTables } from '../support/db';
import { makeComment, makeEvent, makeRsvp, uniqueId } from '../support/factories';

describe('notifyUsers', () => {
  beforeEach(async () => {
    await resetDomainTables();
  });

  it('writes all supplied rows in one call', async () => {
    const userId = uniqueId('user');
    await notifyUsers([
      { userId, eventId: null, type: 'PROMOTION', title: 'a', body: 'b' },
      { userId, eventId: null, type: 'PROMOTION', title: 'c', body: 'd' },
      { userId, eventId: null, type: 'PROMOTION', title: 'e', body: 'f' },
    ]);
    const count = await prisma.notification.count({ where: { userId } });
    expect(count).toBe(3);
  });

  it('empty input is a no-op', async () => {
    await notifyUsers([]);
    const count = await prisma.notification.count();
    expect(count).toBe(0);
  });
});

describe('Promotion notifications', () => {
  beforeEach(async () => {
    await resetDomainTables();
  });

  it('delivered regardless of opt-out', async () => {
    const event = await makeEvent({ maxAttendees: null });
    const optedOut = uniqueId('optedOut');
    await makeRsvp({
      eventId: event.id,
      userId: optedOut,
      status: 'GOING',
      notifyOnUpdate: false,
    });

    await notifyPromotions(
      event.id,
      'Event',
      event.date,
      event.location,
      [optedOut],
      event.timeZone,
    );

    const count = await prisma.notification.count({
      where: { userId: optedOut, type: 'PROMOTION' },
    });
    expect(count).toBe(1);
  });
});

describe('Event-update fan-out', () => {
  beforeEach(async () => {
    await resetDomainTables();
  });

  const before = {
    title: 'Old',
    date: new Date('2026-11-01T10:00:00Z'),
    location: 'Old place',
  };
  const after = {
    title: 'New',
    date: new Date('2026-11-01T11:00:00Z'),
    location: 'New place',
  };

  it('targets GOING, MAYBE, and WAITLISTED holders who opted in', async () => {
    const event = await makeEvent({ maxAttendees: null });
    const organizerId = event.userId;
    const going = uniqueId('going');
    const maybe = uniqueId('maybe');
    const waitlisted = uniqueId('waitlisted');
    await makeRsvp({ eventId: event.id, userId: going, status: 'GOING', notifyOnUpdate: true });
    await makeRsvp({ eventId: event.id, userId: maybe, status: 'MAYBE', notifyOnUpdate: true });
    await makeRsvp({ eventId: event.id, userId: waitlisted, status: 'WAITLISTED', notifyOnUpdate: true });

    const count = await notifyEventUpdated({
      eventId: event.id,
      organizerId,
      before,
      after,
      timeZone: null,
    });
    expect(count).toBe(3);

    const notif = await prisma.notification.findMany({
      where: { eventId: event.id, type: 'EVENT_UPDATED' },
    });
    expect(notif.map((n) => n.userId).sort()).toEqual([going, maybe, waitlisted].sort());
  });

  it('skips opted-out holders', async () => {
    const event = await makeEvent({ maxAttendees: null });
    const organizerId = event.userId;
    const optedOut = uniqueId('optedOut');
    await makeRsvp({ eventId: event.id, userId: optedOut, status: 'GOING', notifyOnUpdate: false });

    const count = await notifyEventUpdated({
      eventId: event.id,
      organizerId,
      before,
      after,
      timeZone: null,
    });
    expect(count).toBe(0);
  });

  it('skips the organizer', async () => {
    const event = await makeEvent({ maxAttendees: null });
    const organizerId = event.userId;
    const holder = uniqueId('holder');
    await makeRsvp({ eventId: event.id, userId: organizerId, status: 'GOING', notifyOnUpdate: true });
    await makeRsvp({ eventId: event.id, userId: holder, status: 'GOING', notifyOnUpdate: true });

    const count = await notifyEventUpdated({
      eventId: event.id,
      organizerId,
      before,
      after,
      timeZone: null,
    });
    expect(count).toBe(1);
    const notif = await prisma.notification.findFirst({
      where: { eventId: event.id, type: 'EVENT_UPDATED' },
    });
    expect(notif?.userId).toBe(holder);
  });

  it('only fires when title, date, or location changed', async () => {
    const event = await makeEvent({ maxAttendees: null });
    const holder = uniqueId('holder');
    await makeRsvp({ eventId: event.id, userId: holder, status: 'GOING', notifyOnUpdate: true });

    const count = await notifyEventUpdated({
      eventId: event.id,
      organizerId: event.userId,
      before,
      after: before, // no change
      timeZone: null,
    });
    expect(count).toBe(0);
    const total = await prisma.notification.count({ where: { type: 'EVENT_UPDATED' } });
    expect(total).toBe(0);
  });
});

describe('Cancellation fan-out', () => {
  beforeEach(async () => {
    await resetDomainTables();
  });

  it('uses eventId: null and keeps the event title in the notification', async () => {
    const event = await makeEvent({ title: 'The Big Event' });
    const recipient = uniqueId('recipient');
    await makeRsvp({ eventId: event.id, userId: recipient, status: 'GOING', notifyOnUpdate: true });

    const count = await notifyEventCancelled({
      eventId: event.id,
      event: {
        title: event.title,
        date: event.date,
        timeZone: event.timeZone,
        location: event.location,
        userId: event.userId,
      },
      recipients: [recipient],
    });
    expect(count).toBe(1);

    const notif = await prisma.notification.findFirst({
      where: { userId: recipient, type: 'EVENT_CANCELLED' },
    });
    expect(notif?.eventId).toBeNull();
    expect(notif?.title).toContain(event.title);
    expect(notif?.body).toContain(event.location);
  });
});

describe('Comment fan-out', () => {
  beforeEach(async () => {
    await resetDomainTables();
  });

  it('deduplicates recipients', async () => {
    const event = await makeEvent({ maxAttendees: null });
    const organizerId = event.userId;
    const author = uniqueId('author');
    const prior = uniqueId('prior');
    // Two comments from the same prior user.
    await makeComment({ eventId: event.id, userId: prior });
    await makeComment({ eventId: event.id, userId: prior });

    const recipients = await selectCommentRecipients(event.id, organizerId, author);
    expect(recipients).toEqual([organizerId, prior]);
  });

  it('caps at 20 recipients', async () => {
    const event = await makeEvent({ maxAttendees: null });
    const organizerId = event.userId;
    const author = uniqueId('author');
    const prior = Array.from({ length: 25 }, () => uniqueId('prior'));
    await Promise.all(
      prior.map((u) => makeComment({ eventId: event.id, userId: u })),
    );

    const recipients = await selectCommentRecipients(event.id, organizerId, author);
    expect(recipients.length).toBeLessThanOrEqual(20);
  });

  it('includes the organizer and excludes the author', async () => {
    const event = await makeEvent({ maxAttendees: null });
    const organizerId = event.userId;
    const author = uniqueId('author');
    const prior = uniqueId('prior');
    await makeComment({ eventId: event.id, userId: prior });

    const recipients = await selectCommentRecipients(event.id, organizerId, author);
    expect(recipients).toContain(organizerId);
    expect(recipients).not.toContain(author);
  });

  it('write failure does not fail the parent action', async () => {
    const event = await makeEvent({ maxAttendees: null });
    const organizerId = event.userId;
    const holder = uniqueId('holder');
    await makeRsvp({ eventId: event.id, userId: holder, status: 'GOING', notifyOnUpdate: true });

    const createManySpy = vi
      .spyOn(prisma.notification, 'createMany')
      .mockRejectedValue(new Error('db down'));
    try {
      const count = await notifyEventUpdated({
        eventId: event.id,
        organizerId,
        before: { title: 'Old', date: new Date('2026-11-01T10:00:00Z'), location: 'Old place' },
        after: { title: 'New', date: new Date('2026-11-01T11:00:00Z'), location: 'New place' },
        timeZone: null,
      });
      // Best-effort: returns 0 on failure rather than throwing.
      expect(count).toBe(0);
    } finally {
      createManySpy.mockRestore();
    }
  });
});
