import { prisma } from '@/db';
import type { EventCategory, Event } from '@/generated/prisma';
import { lockEvent, promoteFromWishlist } from '@/lib/rsvp';

export type UpdateEventCoreOutcome =
  | {
      ok: true;
      before: Pick<
        Event,
        'id' | 'title' | 'date' | 'location' | 'timeZone' | 'userId' | 'maxAttendees'
      >;
      promoted: string[];
      timeZone: string | null;
    }
  | { ok: false; error: string };

/**
 * Request-free core for editing an event.
 *
 * Keeps the per-event advisory lock (`lockEvent`) so the capacity-shrink
 * rejection and the capacity-raise promotion are atomic with respect to
 * concurrent RSVP mutations. Does no auth, rate-limit, revalidation, or
 * notification work: the server action owns that.
 */
export async function updateEventCore(
  eventId: string,
  data: {
    title: string;
    description: string;
    date: Date;
    timeZone: string | null;
    location: string;
    maxAttendees: number | null;
    category: EventCategory;
    isPublic: boolean;
  },
  organizerName: string | null,
  userId: string,
): Promise<UpdateEventCoreOutcome> {
  return prisma.$transaction(
    async (tx) => {
      // Must be the first statement: everything below is a read-then-write
      // sequence that is only correct while this event is locked.
      await lockEvent(tx, eventId);

      // Prevent shrinking capacity below the current GOING count.
      if (data.maxAttendees !== null) {
        const going = await tx.rSVP.count({
          where: { eventId, status: 'GOING' },
        });
        if (data.maxAttendees < going) {
          return {
            ok: false as const,
            error: `Capacity cannot be below the ${going} guests already going.`,
          };
        }
      }

      // Pre-update snapshot for the EVENT_UPDATED diff below.
      const before = await tx.event.findUnique({
        where: { id: eventId },
        select: {
          id: true,
          title: true,
          date: true,
          location: true,
          timeZone: true,
          userId: true,
          maxAttendees: true,
        },
      });
      if (!before) return { ok: false as const, error: 'Event not found.' };

      // Preserve the stored zone when the organizer did not move the wall
      // clock. Legacy rows have `timeZone = null`; writing the fallback on a
      // no-op save would silently shift the event's shown time.
      const sameWallClock =
        Math.floor(data.date.getTime() / 60_000) ===
        Math.floor(before.date.getTime() / 60_000);
      const timeZone = sameWallClock ? before.timeZone : data.timeZone;

      await tx.event.update({
        where: { id: eventId },
        data: {
          ...data,
          timeZone,
          organizerName,
        },
      });

      // A raised cap frees seats immediately: promote inside the same locked
      // transaction so the stored capacity and the wishlist cannot disagree.
      const newCap = data.maxAttendees;
      const raisedCap =
        newCap !== null &&
        (before.maxAttendees === null || newCap > before.maxAttendees);
      const promoted =
        raisedCap && newCap !== null
          ? await promoteFromWishlist(tx, eventId, newCap)
          : [];

      return { ok: true as const, before, promoted, timeZone };
    },
    { timeout: 15_000, maxWait: 15_000 },
  );
}
