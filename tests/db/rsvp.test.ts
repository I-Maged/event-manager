import { beforeEach, describe, expect, it } from 'vitest';
import {
  cancelRsvpCore,
  upsertRsvpCore,
} from '@/lib/rsvp';
import { prisma, resetDomainTables } from '../support/db';
import { makeEvent, uniqueId } from '../support/factories';

describe('RSVP core — capacity and waitlist', () => {
  beforeEach(async () => {
    await resetDomainTables();
  });

  it('uncapped event accepts GOING', async () => {
    const event = await makeEvent({ maxAttendees: null });
    const user = uniqueId('user');
    const result = await upsertRsvpCore(user, event.id, 'GOING', 'Ada');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.status).toBe('GOING');
      expect(result.waitlistPosition).toBeNull();
    }
  });

  it('uncapped event accepts MAYBE', async () => {
    const event = await makeEvent({ maxAttendees: null });
    const result = await upsertRsvpCore(
      uniqueId('user'),
      event.id,
      'MAYBE',
      'Ada',
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.status).toBe('MAYBE');
  });

  it('uncapped event accepts NOT_GOING', async () => {
    const event = await makeEvent({ maxAttendees: null });
    const result = await upsertRsvpCore(
      uniqueId('user'),
      event.id,
      'NOT_GOING',
      'Ada',
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.status).toBe('NOT_GOING');
  });

  it('re-saving the same status is idempotent (same row)', async () => {
    const event = await makeEvent({ maxAttendees: null });
    const user = uniqueId('user');
    const first = await upsertRsvpCore(user, event.id, 'GOING', 'Ada');
    expect(first.ok).toBe(true);
    const firstId = (first as { id?: string }).id ?? null;

    const second = await upsertRsvpCore(user, event.id, 'GOING', 'Ada');
    expect(second.ok).toBe(true);
    const row = await prisma.rSVP.findUnique({
      where: { userId_eventId: { userId: user, eventId: event.id } },
    });
    expect(row?.id).toBe(firstId);
    const count = await prisma.rSVP.count({
      where: { eventId: event.id, userId: user },
    });
    expect(count).toBe(1);
  });

  it('changing status updates the same row', async () => {
    const event = await makeEvent({ maxAttendees: null });
    const user = uniqueId('user');
    const first = await upsertRsvpCore(user, event.id, 'GOING', 'Ada');
    expect(first.ok).toBe(true);
    const firstId = (first as { id?: string }).id ?? null;

    const second = await upsertRsvpCore(user, event.id, 'MAYBE', 'Ada');
    expect(second.ok).toBe(true);
    if (second.ok) expect(second.status).toBe('MAYBE');
    const row = await prisma.rSVP.findUnique({
      where: { userId_eventId: { userId: user, eventId: event.id } },
    });
    expect(row?.id).toBe(firstId);
    expect(row?.status).toBe('MAYBE');
  });

  it('attendeeName is stamped on create and on update', async () => {
    const event = await makeEvent({ maxAttendees: null });
    const user = uniqueId('user');
    await upsertRsvpCore(user, event.id, 'GOING', 'Ada');
    await upsertRsvpCore(user, event.id, 'MAYBE', 'Ada Updated');
    const row = await prisma.rSVP.findUnique({
      where: { userId_eventId: { userId: user, eventId: event.id } },
    });
    expect(row?.attendeeName).toBe('Ada Updated');
  });

  it('capped event with a free seat accepts GOING', async () => {
    const event = await makeEvent({ maxAttendees: 2 });
    const result = await upsertRsvpCore(
      uniqueId('user'),
      event.id,
      'GOING',
      'Ada',
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.status).toBe('GOING');
  });

  it('capped event with no free seat returns WAITLISTED', async () => {
    const event = await makeEvent({ maxAttendees: 1 });
    await upsertRsvpCore(uniqueId('user'), event.id, 'GOING', 'first');
    const result = await upsertRsvpCore(uniqueId('user'), event.id, 'GOING', 'second');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.status).toBe('WAITLISTED');
  });

  it('existing GOING user re-clicking GOING does not become waitlisted', async () => {
    const event = await makeEvent({ maxAttendees: 1 });
    const user = uniqueId('user');
    const first = await upsertRsvpCore(user, event.id, 'GOING', 'Ada');
    expect(first.ok).toBe(true);
    const second = await upsertRsvpCore(user, event.id, 'GOING', 'Ada');
    expect(second.ok).toBe(true);
    if (second.ok) expect(second.status).toBe('GOING');
    const going = await prisma.rSVP.count({
      where: { eventId: event.id, status: 'GOING' },
    });
    expect(going).toBe(1);
  });

  it('switching GOING to MAYBE frees a seat and promotes the oldest waitlisted', async () => {
    const event = await makeEvent({ maxAttendees: 1 });
    const goingUser = uniqueId('going');
    const waitUser = uniqueId('wait');
    await upsertRsvpCore(goingUser, event.id, 'GOING', 'Going');
    await upsertRsvpCore(waitUser, event.id, 'GOING', 'Wait'); // becomes WAITLISTED

    await upsertRsvpCore(goingUser, event.id, 'MAYBE', 'Going');

    const going = await prisma.rSVP.count({
      where: { eventId: event.id, status: 'GOING' },
    });
    const maybe = await prisma.rSVP.count({
      where: { eventId: event.id, status: 'MAYBE' },
    });
    expect(going).toBe(1);
    expect(maybe).toBe(1);
    const promoted = await prisma.rSVP.findFirst({
      where: { eventId: event.id, userId: waitUser, promotedAt: { not: null } },
    });
    expect(promoted).not.toBeNull();
  });

  it('switching GOING to NOT_GOING frees a seat', async () => {
    const event = await makeEvent({ maxAttendees: 1 });
    const goingUser = uniqueId('going');
    await upsertRsvpCore(goingUser, event.id, 'GOING', 'Going');
    await upsertRsvpCore(uniqueId('wait'), event.id, 'GOING', 'Wait'); // WAITLISTED

    await upsertRsvpCore(goingUser, event.id, 'NOT_GOING', 'Going');

    const going = await prisma.rSVP.count({
      where: { eventId: event.id, status: 'GOING' },
    });
    const notGoing = await prisma.rSVP.count({
      where: { eventId: event.id, status: 'NOT_GOING' },
    });
    expect(going).toBe(1);
    expect(notGoing).toBe(1);
  });

  it('switching away from GOING promotes the oldest waitlisted user', async () => {
    const event = await makeEvent({ maxAttendees: 1 });
    const goingUser = uniqueId('going');
    const firstWait = uniqueId('wait1');
    const secondWait = uniqueId('wait2');
    await upsertRsvpCore(goingUser, event.id, 'GOING', 'Going');
    await upsertRsvpCore(firstWait, event.id, 'GOING', 'First Wait');
    await upsertRsvpCore(secondWait, event.id, 'GOING', 'Second Wait');

    await upsertRsvpCore(goingUser, event.id, 'NOT_GOING', 'Going');

    const promoted = await prisma.rSVP.findMany({
      where: { eventId: event.id, status: 'GOING', promotedAt: { not: null } },
      orderBy: { promotedAt: 'asc' },
    });
    expect(promoted).toHaveLength(1);
    expect(promoted[0]?.userId).toBe(firstWait);
  });

  it('waitlist position is 1-based and ordered by creation time', async () => {
    const event = await makeEvent({ maxAttendees: 1 });
    const goingUser = uniqueId('going');
    const first = uniqueId('wait1');
    const second = uniqueId('wait2');
    await upsertRsvpCore(goingUser, event.id, 'GOING', 'Going');
    await upsertRsvpCore(first, event.id, 'GOING', 'First');
    await upsertRsvpCore(second, event.id, 'GOING', 'Second');

    // Derive positions the same way the core does.
    const positionFor = async (userId: string) => {
      const entry = await prisma.rSVP.findUnique({
        where: { userId_eventId: { userId, eventId: event.id } },
        select: { status: true, createdAt: true },
      });
      if (!entry || entry.status !== 'WAITLISTED') return null;
      const ahead = await prisma.rSVP.count({
        where: {
          eventId: event.id,
          status: 'WAITLISTED',
          createdAt: { lt: entry.createdAt },
        },
      });
      return ahead + 1;
    };
    expect(await positionFor(first)).toBe(1);
    expect(await positionFor(second)).toBe(2);
  });

  it('unknown event returns a friendly error', async () => {
    const result = await upsertRsvpCore(
      uniqueId('user'),
      'does-not-exist',
      'GOING',
      'Ada',
    );
    expect(result).toEqual({ ok: false, error: 'Event not found.' });
  });

  it('ended event returns "This event has ended." and writes no row', async () => {
    const event = await makeEvent({ date: new Date(Date.now() - 60_000) });
    const user = uniqueId('late');
    const result = await upsertRsvpCore(user, event.id, 'GOING', 'late');
    expect(result).toEqual({
      ok: false,
      error: 'This event has ended.',
    });
    const row = await prisma.rSVP.findUnique({
      where: { userId_eventId: { userId: user, eventId: event.id } },
    });
    expect(row).toBeNull();
  });
});

describe('Wishlist promotion', () => {
  beforeEach(async () => {
    await resetDomainTables();
  });

  it('promotion is oldest-first', async () => {
    const event = await makeEvent({ maxAttendees: 2 });
    const g1 = uniqueId('g1');
    const g2 = uniqueId('g2');
    const w1 = uniqueId('w1');
    const w2 = uniqueId('w2');
    await upsertRsvpCore(g1, event.id, 'GOING', 'G1');
    await upsertRsvpCore(g2, event.id, 'GOING', 'G2'); // cap full
    await upsertRsvpCore(w1, event.id, 'GOING', 'W1'); // WAITLISTED
    await upsertRsvpCore(w2, event.id, 'GOING', 'W2'); // WAITLISTED

    await upsertRsvpCore(g1, event.id, 'NOT_GOING', 'G1'); // frees 1 seat

    const promoted = await prisma.rSVP.findMany({
      where: { eventId: event.id, promotedAt: { not: null } },
      orderBy: { promotedAt: 'asc' },
    });
    expect(promoted).toHaveLength(1);
    expect(promoted[0]?.userId).toBe(w1);
  });

  it('promoted rows get promotedAt set', async () => {
    const event = await makeEvent({ maxAttendees: 1 });
    const goingUser = uniqueId('going');
    const waitUser = uniqueId('wait');
    await upsertRsvpCore(goingUser, event.id, 'GOING', 'Going');
    await upsertRsvpCore(waitUser, event.id, 'GOING', 'Wait');

    await upsertRsvpCore(goingUser, event.id, 'NOT_GOING', 'Going');

    const row = await prisma.rSVP.findUnique({
      where: { userId_eventId: { userId: waitUser, eventId: event.id } },
    });
    expect(row?.promotedAt).not.toBeNull();
  });

  it('promoted user ids are returned to the caller', async () => {
    const event = await makeEvent({ maxAttendees: 1 });
    const goingUser = uniqueId('going');
    const waitUser = uniqueId('wait');
    await upsertRsvpCore(goingUser, event.id, 'GOING', 'Going');
    await upsertRsvpCore(waitUser, event.id, 'GOING', 'Wait');

    const result = await upsertRsvpCore(goingUser, event.id, 'NOT_GOING', 'Going');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.promoted).toContain(waitUser);
    }
  });

  it('no promotion happens while room <= 0', async () => {
    const event = await makeEvent({ maxAttendees: 1 });
    const goingUser = uniqueId('going');
    const waitUser = uniqueId('wait');
    await upsertRsvpCore(goingUser, event.id, 'GOING', 'Going');
    await upsertRsvpCore(waitUser, event.id, 'GOING', 'Wait'); // WAITLISTED, no room

    const result = await upsertRsvpCore(waitUser, event.id, 'GOING', 'Wait');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.promoted).toHaveLength(0);
  });

  it('promotion drains a queue larger than one batch', async () => {
    const event = await makeEvent({ maxAttendees: 3 });
    const users = Array.from({ length: 6 }, () => uniqueId('guest'));
    // 3 GOING fill the cap, 3 waitlisted
    for (const u of users) {
      await upsertRsvpCore(u, event.id, 'GOING', u);
    }
    const going = await prisma.rSVP.count({
      where: { eventId: event.id, status: 'GOING' },
    });
    expect(going).toBe(3);

    // All 3 GOING switch away -> frees 3 seats -> all 3 waitlisted promoted
    await Promise.all(
      users.slice(0, 3).map((u) => upsertRsvpCore(u, event.id, 'NOT_GOING', u)),
    );

    const finalGoing = await prisma.rSVP.count({
      where: { eventId: event.id, status: 'GOING' },
    });
    const finalWaitlisted = await prisma.rSVP.count({
      where: { eventId: event.id, status: 'WAITLISTED' },
    });
    expect(finalGoing).toBe(3);
    expect(finalWaitlisted).toBe(0);
  });

  it('a user joining a full event is promoted in the same call when a seat frees', async () => {
    const event = await makeEvent({ maxAttendees: 1 });
    const holder = uniqueId('holder');
    const joiner = uniqueId('joiner');
    await upsertRsvpCore(holder, event.id, 'GOING', 'Holder');

    // Joiner becomes WAITLISTED (full).
    const joinResult = await upsertRsvpCore(joiner, event.id, 'GOING', 'Joiner');
    expect(joinResult.ok).toBe(true);
    if (joinResult.ok) expect(joinResult.status).toBe('WAITLISTED');

    // Holder leaves -> joiner promoted in the same locked flow.
    await upsertRsvpCore(holder, event.id, 'NOT_GOING', 'Holder');

    const row = await prisma.rSVP.findUnique({
      where: { userId_eventId: { userId: joiner, eventId: event.id } },
    });
    expect(row?.status).toBe('GOING');
    expect(row?.promotedAt).not.toBeNull();
  });

  it('promotion preserves the attendee name and other row fields', async () => {
    const event = await makeEvent({ maxAttendees: 1 });
    const goingUser = uniqueId('going');
    const waitUser = uniqueId('wait');
    await upsertRsvpCore(goingUser, event.id, 'GOING', 'Going');
    await upsertRsvpCore(waitUser, event.id, 'GOING', 'Wait Name');

    await upsertRsvpCore(goingUser, event.id, 'NOT_GOING', 'Going');

    const row = await prisma.rSVP.findUnique({
      where: { userId_eventId: { userId: waitUser, eventId: event.id } },
    });
    expect(row?.attendeeName).toBe('Wait Name');
    expect(row?.status).toBe('GOING');
  });

  it('promotion never exceeds the cap', async () => {
    const event = await makeEvent({ maxAttendees: 2 });
    const g1 = uniqueId('g1');
    const g2 = uniqueId('g2');
    const w1 = uniqueId('w1');
    const w2 = uniqueId('w2');
    await upsertRsvpCore(g1, event.id, 'GOING', 'G1');
    await upsertRsvpCore(g2, event.id, 'GOING', 'G2');
    await upsertRsvpCore(w1, event.id, 'GOING', 'W1');
    await upsertRsvpCore(w2, event.id, 'GOING', 'W2');

    await upsertRsvpCore(g1, event.id, 'NOT_GOING', 'G1');
    await upsertRsvpCore(g2, event.id, 'NOT_GOING', 'G2');

    const going = await prisma.rSVP.count({
      where: { eventId: event.id, status: 'GOING' },
    });
    expect(going).toBeLessThanOrEqual(2);
  });
});

describe('Cancellation', () => {
  beforeEach(async () => {
    await resetDomainTables();
  });

  it('cancel removes the caller row', async () => {
    const event = await makeEvent({ maxAttendees: null });
    const user = uniqueId('user');
    await upsertRsvpCore(user, event.id, 'GOING', 'Ada');
    const result = await cancelRsvpCore(user, event.id);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.hadRsvp).toBe(true);
    const row = await prisma.rSVP.findUnique({
      where: { userId_eventId: { userId: user, eventId: event.id } },
    });
    expect(row).toBeNull();
  });

  it('cancel promotes waitlisted users when a seat frees', async () => {
    const event = await makeEvent({ maxAttendees: 1 });
    const holder = uniqueId('holder');
    const waiter = uniqueId('waiter');
    await upsertRsvpCore(holder, event.id, 'GOING', 'Holder');
    await upsertRsvpCore(waiter, event.id, 'GOING', 'Waiter'); // WAITLISTED

    const result = await cancelRsvpCore(holder, event.id);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.promoted).toContain(waiter);

    const row = await prisma.rSVP.findUnique({
      where: { userId_eventId: { userId: waiter, eventId: event.id } },
    });
    expect(row?.status).toBe('GOING');
  });

  it('cancel reports hadRsvp correctly', async () => {
    const event = await makeEvent({ maxAttendees: null });
    const user = uniqueId('user');
    await upsertRsvpCore(user, event.id, 'GOING', 'Ada');
    const withRsvp = await cancelRsvpCore(user, event.id);
    expect(withRsvp.ok).toBe(true);
    if (withRsvp.ok) expect(withRsvp.hadRsvp).toBe(true);

    const without = await cancelRsvpCore(user, event.id);
    expect(without.ok).toBe(true);
    if (without.ok) expect(without.hadRsvp).toBe(false);
  });

  it('cancel returns organizer id and notify preference', async () => {
    const event = await makeEvent({ maxAttendees: null });
    const user = uniqueId('user');
    await upsertRsvpCore(user, event.id, 'GOING', 'Ada');
    const result = await cancelRsvpCore(user, event.id);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.organizerId).toBe(event.userId);
      expect(typeof result.organizerNotify).toBe('boolean');
    }
  });

  it('cancel with no row is safe', async () => {
    const event = await makeEvent({ maxAttendees: null });
    const result = await cancelRsvpCore(uniqueId('user'), event.id);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.hadRsvp).toBe(false);
  });

  it('cancel on an ended event is rejected without writes', async () => {
    const event = await makeEvent({ date: new Date(Date.now() - 60_000) });
    const user = uniqueId('late');
    await upsertRsvpCore(user, event.id, 'GOING', 'late');
    const before = await prisma.rSVP.count({
      where: { eventId: event.id, userId: user },
    });
    expect(before).toBe(1);

    const result = await cancelRsvpCore(user, event.id);
    expect(result).toEqual({ ok: false, error: 'This event has ended.' });

    const after = await prisma.rSVP.count({
      where: { eventId: event.id, userId: user },
    });
    expect(after).toBe(1);
  });

  it('cancel on an unknown event is rejected', async () => {
    const result = await cancelRsvpCore(uniqueId('user'), 'does-not-exist');
    expect(result).toEqual({ ok: false, error: 'Event not found.' });
  });
});
