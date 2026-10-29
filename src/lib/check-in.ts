import { prisma } from '@/db';

export type CheckInCoreResult =
  | { ok: true; checkedInAt: string | null }
  | { ok: false; error: string };

/**
 * Check in a GOING attendee. Idempotent. Returns the stored timestamp.
 *
 * Does no auth, rate-limit, or revalidation work: the server action owns
 * that. Callers pass the organizer id explicitly so DB integration tests can
 * drive the core directly without a session.
 */
export async function checkInAttendeeCore(
  eventId: string,
  attendeeUserId: string,
  organizerId: string,
): Promise<CheckInCoreResult> {
  try {
    const now = new Date();
    const claimed = await prisma.rSVP.updateMany({
      where: {
        eventId,
        userId: attendeeUserId,
        status: 'GOING',
        checkedInAt: null,
      },
      data: { checkedInAt: now, checkedInBy: organizerId },
    });

    if (claimed.count === 0) {
      const rsvp = await prisma.rSVP.findUnique({
        where: { userId_eventId: { userId: attendeeUserId, eventId } },
        select: { status: true, checkedInAt: true },
      });
      if (!rsvp) return { ok: false, error: 'Attendee not found.' };
      if (rsvp.status !== 'GOING') {
        return { ok: false, error: 'Only Going attendees can be checked in.' };
      }
      // Already checked in: idempotent success with the stored timestamp.
      return { ok: true, checkedInAt: rsvp.checkedInAt?.toISOString() ?? null };
    }

    return { ok: true, checkedInAt: now.toISOString() };
  } catch (error) {
    console.error('checkInAttendeeCore failed', { eventId, attendeeUserId, error });
    return { ok: false, error: 'Check-in failed. Please retry.' };
  }
}

/**
 * Undo a check-in. Idempotent. Returns null on success (cleared timestamp).
 *
 * Does no auth, rate-limit, or revalidation work: the server action owns
 * that. Callers pass the organizer id explicitly so DB integration tests can
 * drive the core directly without a session.
 */
export async function undoCheckInCore(
  eventId: string,
  attendeeUserId: string,
  organizerId: string,
): Promise<CheckInCoreResult> {
  void organizerId;
  try {
    await prisma.rSVP.updateMany({
      where: { eventId, userId: attendeeUserId, checkedInAt: { not: null } },
      data: { checkedInAt: null, checkedInBy: null },
    });

    const rsvp = await prisma.rSVP.findUnique({
      where: { userId_eventId: { userId: attendeeUserId, eventId } },
      select: { checkedInAt: true },
    });
    if (!rsvp) return { ok: false, error: 'Attendee not found.' };

    return { ok: true, checkedInAt: rsvp.checkedInAt?.toISOString() ?? null };
  } catch (error) {
    console.error('undoCheckInCore failed', { eventId, attendeeUserId, error });
    return { ok: false, error: 'Undo check-in failed. Please retry.' };
  }
}
