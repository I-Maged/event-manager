import { beforeEach, describe, expect, it } from 'vitest';
import type { RSVPStatus } from '@/generated/prisma';
import {
  checkInAttendeeCore,
  undoCheckInCore,
} from '@/lib/check-in';
import { prisma, resetDomainTables } from '../support/db';
import { makeEvent, makeRsvp, uniqueId } from '../support/factories';

describe('Check-in', () => {
  beforeEach(async () => {
    await resetDomainTables();
  });

  async function seedGoing(eventId: string, userId: string) {
    await makeRsvp({ eventId, userId, status: 'GOING' });
  }

  it('first check-in stores checkedInAt and checkedInBy', async () => {
    const event = await makeEvent({ maxAttendees: null });
    const attendee = uniqueId('attendee');
    const organizer = uniqueId('organizer');
    await seedGoing(event.id, attendee);

    const result = await checkInAttendeeCore(
      event.id,
      attendee,
      organizer,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.checkedInAt).not.toBeNull();
      const row = await prisma.rSVP.findUnique({
        where: { userId_eventId: { userId: attendee, eventId: event.id } },
        select: { checkedInAt: true, checkedInBy: true },
      });
      expect(row?.checkedInAt).not.toBeNull();
      expect(row?.checkedInBy).toBe(organizer);
    }
  });

  it('second check-in is idempotent and returns the same timestamp', async () => {
    const event = await makeEvent({ maxAttendees: null });
    const attendee = uniqueId('attendee');
    const organizer = uniqueId('organizer');
    await seedGoing(event.id, attendee);

    const first = await checkInAttendeeCore(event.id, attendee, organizer);
    expect(first.ok).toBe(true);
    const firstStamp = (first as { checkedInAt: string | null }).checkedInAt;

    const second = await checkInAttendeeCore(event.id, attendee, organizer);
    expect(second.ok).toBe(true);
    const secondStamp = (second as { checkedInAt: string | null }).checkedInAt;
    expect(secondStamp).toBe(firstStamp);

    // Exactly one row with a non-null checkedInAt.
    const count = await prisma.rSVP.count({
      where: {
        eventId: event.id,
        userId: attendee,
        checkedInAt: { not: null },
      },
    });
    expect(count).toBe(1);
  });

  it.each([['MAYBE'], ['NOT_GOING'], ['WAITLISTED']])(
    'checking in a %s row is rejected',
    async (status) => {
      const event = await makeEvent({ maxAttendees: null });
      const attendee = uniqueId('attendee');
      const organizer = uniqueId('organizer');
      await makeRsvp({ eventId: event.id, userId: attendee, status: status as RSVPStatus });

      const result = await checkInAttendeeCore(event.id, attendee, organizer);
      expect(result).toEqual({
        ok: false,
        error: 'Only Going attendees can be checked in.',
      });
    },
  );

  it('checking in a missing attendee is rejected', async () => {
    const event = await makeEvent({ maxAttendees: null });
    const result = await checkInAttendeeCore(
      event.id,
      uniqueId('attendee'),
      uniqueId('organizer'),
    );
    expect(result).toEqual({ ok: false, error: 'Attendee not found.' });
  });

  it('undo clears both checkedInAt and checkedInBy', async () => {
    const event = await makeEvent({ maxAttendees: null });
    const attendee = uniqueId('attendee');
    const organizer = uniqueId('organizer');
    await seedGoing(event.id, attendee);
    await checkInAttendeeCore(event.id, attendee, organizer);

    const result = await undoCheckInCore(event.id, attendee, organizer);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.checkedInAt).toBeNull();

    const row = await prisma.rSVP.findUnique({
      where: { userId_eventId: { userId: attendee, eventId: event.id } },
      select: { checkedInAt: true, checkedInBy: true },
    });
    expect(row?.checkedInAt).toBeNull();
    expect(row?.checkedInBy).toBeNull();
  });

  it('undo twice is safe and leaves both fields null', async () => {
    const event = await makeEvent({ maxAttendees: null });
    const attendee = uniqueId('attendee');
    const organizer = uniqueId('organizer');
    await seedGoing(event.id, attendee);
    await checkInAttendeeCore(event.id, attendee, organizer);

    const first = await undoCheckInCore(event.id, attendee, organizer);
    expect(first.ok).toBe(true);
    const second = await undoCheckInCore(event.id, attendee, organizer);
    expect(second.ok).toBe(true);

    const row = await prisma.rSVP.findUnique({
      where: { userId_eventId: { userId: attendee, eventId: event.id } },
      select: { checkedInAt: true, checkedInBy: true },
    });
    expect(row?.checkedInAt).toBeNull();
    expect(row?.checkedInBy).toBeNull();
  });

  it('two concurrent check-ins store exactly one timestamp', async () => {
    const event = await makeEvent({ maxAttendees: null });
    const attendee = uniqueId('attendee');
    const organizer = uniqueId('organizer');
    await seedGoing(event.id, attendee);

    const results = await Promise.all([
      checkInAttendeeCore(event.id, attendee, organizer),
      checkInAttendeeCore(event.id, attendee, organizer),
    ]);
    const okResults = results.filter((r) => r.ok);
    expect(okResults).toHaveLength(1);

    const count = await prisma.rSVP.count({
      where: {
        eventId: event.id,
        userId: attendee,
        checkedInAt: { not: null },
      },
    });
    expect(count).toBe(1);
  });

  it('two concurrent undos leave both fields null', async () => {
    const event = await makeEvent({ maxAttendees: null });
    const attendee = uniqueId('attendee');
    const organizer = uniqueId('organizer');
    await seedGoing(event.id, attendee);
    await checkInAttendeeCore(event.id, attendee, organizer);

    await Promise.all([
      undoCheckInCore(event.id, attendee, organizer),
      undoCheckInCore(event.id, attendee, organizer),
    ]);

    const row = await prisma.rSVP.findUnique({
      where: { userId_eventId: { userId: attendee, eventId: event.id } },
      select: { checkedInAt: true, checkedInBy: true },
    });
    expect(row?.checkedInAt).toBeNull();
    expect(row?.checkedInBy).toBeNull();
  });
});
