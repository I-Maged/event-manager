import { beforeEach, describe, expect, it } from 'vitest';
import {
  checkInAttendeeCore,
  undoCheckInCore,
} from '@/lib/check-in';
import {
  notifyEventCancelled,
  notifyEventUpdated,
  notifyNewComment,
  selectEventUpdateRecipients,
} from '@/lib/event-notifications';
import { enforceRateLimit } from '@/lib/rate-limit';
import { cancelRsvpCore, notifyPromotions } from '@/lib/rsvp';
import { updateEventCore } from '@/lib/update-event';
import { prisma, resetDomainTables } from '../support/db';
import { makeComment, makeEvent, makeRsvp, uniqueId } from '../support/factories';
import {
  captureConsoleError,
  duringFault,
  failModel,
  failPrismaMethod,
} from '../support/faults';

/**
 * Phase 6.1 — fault injection.
 *
 * Each test breaks one DB call and asserts the user-visible contract survives:
 * the parent write is committed, the fan-out is skipped, and the core returns an
 * error value instead of throwing. The server actions add auth/redirect only;
 * their ordering (commit first, best-effort fan-out second) is exercised
 * end-to-end in Phase 5, so this layer drives the request-free cores.
 */
describe('Fault injection (6.1)', () => {
  beforeEach(async () => {
    await resetDomainTables();
  });

  it('promotion survives a notification failure', async () => {
    const event = await makeEvent({ maxAttendees: 1 });
    const going = uniqueId('going');
    const waiting = uniqueId('waiting');
    await makeRsvp({
      eventId: event.id,
      userId: going,
      status: 'GOING',
      attendeeName: 'Going User',
    });
    await makeRsvp({
      eventId: event.id,
      userId: waiting,
      status: 'WAITLISTED',
      attendeeName: 'Waiting User',
    });

    // The promotion commits inside the locked transaction...
    const cancelled = await cancelRsvpCore(going, event.id);
    expect(cancelled.ok).toBe(true);
    if (!cancelled.ok) return;
    expect(cancelled.promoted).toEqual([waiting]);

    // ...and the PROMOTION fan-out that follows is allowed to fail.
    const fault = failModel('notification', 'createMany');
    await duringFault(fault, async () => {
      await expect(
        notifyPromotions(
          event.id,
          event.title,
          event.date,
          event.location,
          cancelled.promoted,
          event.timeZone,
        ),
      ).resolves.toBeUndefined();
    });

    const row = await prisma.rSVP.findUnique({
      where: { userId_eventId: { userId: waiting, eventId: event.id } },
      select: { status: true, promotedAt: true, attendeeName: true },
    });
    expect(row?.status).toBe('GOING');
    expect(row?.promotedAt).not.toBeNull();
    expect(row?.attendeeName).toBe('Waiting User');
    expect(await prisma.notification.count({ where: { userId: waiting } })).toBe(0);
  });

  it('event-update notification failure does not undo the edit', async () => {
    const organizerId = uniqueId('organizer');
    const event = await makeEvent({
      userId: organizerId,
      maxAttendees: null,
      title: 'Original title',
    });
    const holder = uniqueId('holder');
    await makeRsvp({
      eventId: event.id,
      userId: holder,
      status: 'GOING',
      notifyOnUpdate: true,
    });

    const data = {
      title: 'Edited title',
      description: event.description,
      date: event.date,
      timeZone: event.timeZone,
      location: event.location,
      maxAttendees: null,
      category: 'OTHER' as const,
      isPublic: true,
    };

    const outcome = await updateEventCore(event.id, data, 'Organizer', organizerId);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    const fault = failModel('notification', 'createMany');
    const count = await duringFault(fault, () =>
      notifyEventUpdated({
        eventId: event.id,
        organizerId: outcome.before.userId,
        before: outcome.before,
        after: data,
        timeZone: outcome.timeZone,
      }),
    );
    expect(count).toBe(0);

    const stored = await prisma.event.findUnique({
      where: { id: event.id },
      select: { title: true },
    });
    expect(stored?.title).toBe('Edited title');

    // The edit itself did not need a notification to be valid.
    expect(await prisma.notification.count({ where: { eventId: event.id } })).toBe(0);
  });

  it('cancellation notification failure does not fail the cancel', async () => {
    const event = await makeEvent({ maxAttendees: null });
    const recipient = uniqueId('recipient');
    await makeRsvp({
      eventId: event.id,
      userId: recipient,
      status: 'GOING',
      notifyOnUpdate: true,
    });

    // Recipients must be captured before the delete cascades the RSVPs.
    const recipients = await selectEventUpdateRecipients(event.id, event.userId);
    expect(recipients).toEqual([recipient]);
    const snapshot = {
      title: event.title,
      date: event.date,
      timeZone: event.timeZone,
      location: event.location,
      userId: event.userId,
    };

    await prisma.event.delete({ where: { id: event.id } });

    const fault = failModel('notification', 'createMany');
    const count = await duringFault(fault, () =>
      notifyEventCancelled({ eventId: event.id, event: snapshot, recipients }),
    );
    expect(count).toBe(0);

    await expect(
      prisma.event.findUnique({ where: { id: event.id } }),
    ).resolves.toBeNull();
  });

  it('comment notification failure does not fail the comment', async () => {
    const event = await makeEvent({ maxAttendees: null });
    const author = uniqueId('author');
    const prior = uniqueId('prior');
    await makeComment({ eventId: event.id, userId: prior });

    const comment = await prisma.comment.create({
      data: { eventId: event.id, userId: author, authorName: 'Author', body: 'Hello' },
      select: { id: true },
    });

    const fault = failModel('notification', 'createMany');
    const count = await duringFault(fault, () =>
      notifyNewComment({
        eventId: event.id,
        eventTitle: event.title,
        organizerId: event.userId,
        authorId: author,
        body: 'Hello',
      }),
    );
    expect(count).toBe(0);

    await expect(
      prisma.comment.findUnique({ where: { id: comment.id } }),
    ).resolves.not.toBeNull();
    expect(await prisma.notification.count()).toBe(0);
  });

  it('check-in returns {ok:false} rather than throwing on DB failure', async () => {
    const event = await makeEvent({ maxAttendees: null });
    const attendee = uniqueId('attendee');
    const organizer = uniqueId('organizer');
    await makeRsvp({ eventId: event.id, userId: attendee, status: 'GOING' });

    const logs = captureConsoleError();
    const fault = failModel('rSVP', 'updateMany');
    try {
      await expect(
        checkInAttendeeCore(event.id, attendee, organizer),
      ).resolves.toEqual({ ok: false, error: 'Check-in failed. Please retry.' });
      await expect(
        undoCheckInCore(event.id, attendee, organizer),
      ).resolves.toEqual({ ok: false, error: 'Undo check-in failed. Please retry.' });
    } finally {
      fault.restore();
    }
    const logged = logs.text();
    logs.restore();

    expect(logged).toContain('checkInAttendeeCore failed');
    expect(logged).toContain('undoCheckInCore failed');
  });

  it('a limiter outage does not block the write it guards', async () => {
    const event = await makeEvent({ maxAttendees: null });
    const userId = uniqueId('commenter');

    const logs = captureConsoleError();
    const fault = failPrismaMethod('$queryRaw');
    let decision: Awaited<ReturnType<typeof enforceRateLimit>>;
    try {
      decision = await enforceRateLimit('comment', userId);
    } finally {
      fault.restore();
    }
    const logged = logs.text();
    logs.restore();

    // Fail open: the action is allowed to proceed.
    expect(decision).toBeNull();
    expect(logged).toContain('rate limit check failed');

    // ...and the write that follows really happens.
    const comment = await prisma.comment.create({
      data: {
        eventId: event.id,
        userId,
        authorName: 'Commenter',
        body: 'still writes',
      },
      select: { id: true },
    });
    expect(comment.id.length).toBeGreaterThan(0);
  });
});
