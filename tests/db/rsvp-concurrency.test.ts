import { beforeEach, describe, expect, it } from 'vitest';
import {
  cancelRsvpCore,
  promoteFromWishlist,
  upsertRsvpCore,
} from '@/lib/rsvp';
import { updateEventCore } from '@/lib/update-event';
import { prisma, resetDomainTables } from '../support/db';
import { makeEvent, uniqueId } from '../support/factories';

/**
 * Ported from `scripts/rsvp-concurrency.ts`. The bug is a scheduling race, so
 * each scenario repeats; counts are env-tunable so PR runs stay fast and a
 * nightly job can crank them up.
 *
 *   TEST_ROUNDS=10 TEST_RACERS=16 npm run test:db
 */
const ROUNDS = Number(process.env.TEST_ROUNDS ?? 2);
const RACERS = Number(process.env.TEST_RACERS ?? 6);

async function counts(eventId: string) {
  const [going, waitlisted, promoted] = await Promise.all([
    prisma.rSVP.count({ where: { eventId, status: 'GOING' } }),
    prisma.rSVP.count({ where: { eventId, status: 'WAITLISTED' } }),
    prisma.rSVP.count({ where: { eventId, promotedAt: { not: null } } }),
  ]);
  return { going, waitlisted, promoted };
}

describe('RSVP concurrency invariants', () => {
  beforeEach(async () => {
    await resetDomainTables();
  });

  it('cap 1 with N concurrent racers produces exactly one GOING', async () => {
    for (let round = 1; round <= ROUNDS; round += 1) {
      const event = await makeEvent({ maxAttendees: 1 });
      const users = Array.from({ length: RACERS }, () => uniqueId('racer'));

      await Promise.all(
        users.map((user) => upsertRsvpCore(user, event.id, 'GOING', user)),
      );

      const result = await counts(event.id);
      expect(result, `round ${round}`).toEqual({
        going: 1,
        waitlisted: RACERS - 1,
        promoted: 0,
      });
    }
  });

  it('two concurrent cancels promote two distinct waitlisted users', async () => {
    for (let round = 1; round <= ROUNDS; round += 1) {
      const event = await makeEvent({ maxAttendees: 2 });
      const [a, b, w1, w2] = [
        uniqueId('going'),
        uniqueId('going'),
        uniqueId('wait'),
        uniqueId('wait'),
      ];

      await prisma.rSVP.createMany({
        data: [
          { eventId: event.id, userId: a, status: 'GOING' },
          { eventId: event.id, userId: b, status: 'GOING' },
          { eventId: event.id, userId: w1, status: 'WAITLISTED' },
          { eventId: event.id, userId: w2, status: 'WAITLISTED' },
        ],
      });

      await Promise.all([
        cancelRsvpCore(a, event.id),
        cancelRsvpCore(b, event.id),
      ]);

      const { going, waitlisted, promoted } = await counts(event.id);
      expect(going, `round ${round}`).toBe(2);
      expect(waitlisted).toBe(0);
      expect(promoted).toBe(2);

      const promotedRows = await prisma.rSVP.findMany({
        where: { eventId: event.id, promotedAt: { not: null } },
        select: { userId: true },
      });
      expect(new Set(promotedRows.map((row) => row.userId)).size).toBe(2);
    }
  });

  it('raising the cap promotes exactly the freed slots', async () => {
    const event = await makeEvent({ maxAttendees: 1 });
    const [first, ...rest] = Array.from({ length: 4 }, () => uniqueId('guest'));

    await upsertRsvpCore(first, event.id, 'GOING', 'first');
    await Promise.all(
      rest.map((user) => upsertRsvpCore(user, event.id, 'GOING', user)),
    );

    const promoted = await prisma.$transaction(async (tx) => {
      await tx.event.update({
        where: { id: event.id },
        data: { maxAttendees: 3 },
      });
      return promoteFromWishlist(tx, event.id, 3);
    });

    const result = await counts(event.id);
    expect(result.going).toBe(3);
    expect(result.waitlisted).toBe(1);
    expect(promoted).toHaveLength(2);
    expect(result.promoted).toBe(2);
  });

  it('rejects RSVPs for an ended event without writing a row', async () => {
    const event = await makeEvent({ date: new Date(Date.now() - 60_000) });
    const user = uniqueId('late');

    const outcome = await upsertRsvpCore(user, event.id, 'GOING', 'late');

    expect(outcome).toEqual({ ok: false, error: 'This event has ended.' });
    await expect(
      prisma.rSVP.findUnique({
        where: { userId_eventId: { userId: user, eventId: event.id } },
      }),
    ).resolves.toBeNull();
  });

  it('capacity raise during concurrent writers cannot overbook', async () => {
    for (let round = 1; round <= ROUNDS; round += 1) {
      const event = await makeEvent({ maxAttendees: 1 });
      const users = Array.from({ length: RACERS }, () => uniqueId('racer'));

      // N concurrent GOING writers on a cap-1 event -> 1 GOING, rest waitlisted.
      await Promise.all(
        users.map((user) => upsertRsvpCore(user, event.id, 'GOING', user)),
      );

      // Then raise the cap inside a locked transaction. Must not overbook.
      const raised = await prisma.$transaction(async (tx) => {
        await tx.event.update({
          where: { id: event.id },
          data: { maxAttendees: 3 },
        });
        return promoteFromWishlist(tx, event.id, 3);
      });

      const { going, waitlisted } = await counts(event.id);
      expect(going, `round ${round}`).toBeLessThanOrEqual(3);
      expect(going + waitlisted, `round ${round}`).toBe(RACERS);
      expect(raised.length).toBeGreaterThanOrEqual(0);
    }
  });

  it('capacity shrink below the GOING count is rejected inside the lock', async () => {
    const event = await makeEvent({ maxAttendees: 3 });
    const users = Array.from({ length: 2 }, () => uniqueId('racer'));
    await Promise.all(
      users.map((user) => upsertRsvpCore(user, event.id, 'GOING', user)),
    );

    const goingBefore = await prisma.rSVP.count({
      where: { eventId: event.id, status: 'GOING' },
    });
    expect(goingBefore).toBe(2);

    // Attempt to shrink below the current GOING count -> rejected.
    const outcome = await updateEventCore(
      event.id,
      {
        title: event.title,
        description: event.description,
        date: event.date,
        timeZone: event.timeZone,
        location: event.location,
        maxAttendees: 1,
        category: event.category,
        isPublic: event.isPublic,
      },
      'Test Organizer',
      event.userId,
    );
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error).toContain('Capacity cannot be below');

    const goingAfter = await prisma.rSVP.count({
      where: { eventId: event.id, status: 'GOING' },
    });
    expect(goingAfter).toBe(2);
    const stored = await prisma.event.findUnique({
      where: { id: event.id },
      select: { maxAttendees: true },
    });
    expect(stored?.maxAttendees).toBe(3);
  });

  it('mutations for different events do not block each other', async () => {
    const [eventA, eventB] = await Promise.all([
      makeEvent({ maxAttendees: 1 }),
      makeEvent({ maxAttendees: 1 }),
    ]);
    const userA = uniqueId('userA');
    const userB = uniqueId('userB');

    const results = await Promise.all([
      upsertRsvpCore(userA, eventA.id, 'GOING', 'A'),
      upsertRsvpCore(userB, eventB.id, 'GOING', 'B'),
    ]);

    expect(results[0].ok).toBe(true);
    expect(results[1].ok).toBe(true);
    if (results[0].ok) expect(results[0].status).toBe('GOING');
    if (results[1].ok) expect(results[1].status).toBe('GOING');
  });
});
