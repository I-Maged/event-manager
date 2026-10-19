import { prisma } from '@/db';
import type { Prisma, RSVPStatus } from '@/generated/prisma';
import { formatEventDate } from '@/lib/events';
import { notifyUsers } from '@/lib/notifications';

type Tx = Prisma.TransactionClient;

export const SETTABLE_STATUSES = ['GOING', 'MAYBE', 'NOT_GOING'] as const;
export type SettableStatus = (typeof SETTABLE_STATUSES)[number];

/** Client-facing result shape shared by setRsvp/joinWishlist/acceptInvite. */
export type RsvpResult =
  | { ok: true; status: RSVPStatus; waitlistPosition: number | null }
  | { ok: false; error: string };

/**
 * Richer core outcome: the wrapper in `events/actions.ts` needs the event
 * fields and the promoted user ids to fan out PROMOTION notifications, so the
 * DB core stays free of auth/revalidate/notification work.
 */
export type UpsertRsvpOutcome =
  | {
      ok: true;
      status: RSVPStatus;
      waitlistPosition: number | null;
      promoted: string[];
      eventTitle: string;
      eventDate: Date;
      eventLocation: string;
    }
  | { ok: false; error: string };

export type CancelRsvpOutcome =
  | {
      ok: true;
      hadRsvp: boolean;
      promoted: string[];
      eventTitle: string;
      eventDate: Date;
      eventLocation: string;
      organizerId: string;
      organizerNotify: boolean;
    }
  | { ok: false; error: string };

/**
 * Serializes every RSVP mutation for one event.
 *
 * Postgres advisory locks are released when the transaction ends, so a
 * writer that reaches this line is guaranteed exclusive access for the rest
 * of its read-then-write sequence (count -> upsert -> promote). That is what
 * makes the cap check and the waitlist promotion correct under concurrency:
 * plain interactive transactions run at READ COMMITTED and do NOT provide
 * this, so two writers can both read "one seat free" and both commit.
 *
 * `hashtext` maps the cuid to the int4 key the two-arg lock form expects;
 * a collision only over-serializes two unrelated events, which is harmless.
 *
 * Transaction-scoped (`_xact_`) on purpose: the pooled Neon connection runs
 * through PgBouncer in transaction mode, where session-scoped locks would
 * leak across requests.
 *
 * `$executeRaw`, not `$queryRaw`: the function returns `void`, and the Neon
 * driver adapter can only map column types on the query path — it throws
 * `UnsupportedNativeDataType` for `void`. The execute path returns rowCount
 * and never deserializes, which is exactly what this call needs.
 */
export async function lockEvent(tx: Tx, eventId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${eventId}), 0)`;
}

/**
 * Fill free GOING slots from the wishlist (oldest first), flagging each
 * promoted row so the UI can show a "You got in!" banner. Returns the
 * promoted user ids so callers can fan out PROMOTION notifications.
 *
 * One set-based claim per batch instead of a findFirst+update loop: the
 * `UPDATE ... WHERE id IN (SELECT ... ORDER BY createdAt LIMIT n)` statement
 * is atomic, so two concurrent callers can never claim the same waitlisted
 * row, and N round-trips collapse into one per `batch` promotions.
 *
 * Callers must already hold `lockEvent` for this event (both RSVP cores and
 * the capacity-raise path in updateEvent do).
 */
export async function promoteFromWishlist(
  tx: Tx,
  eventId: string,
  cap: number,
  batch = 200,
): Promise<string[]> {
  const promoted: string[] = [];
  for (;;) {
    const going = await tx.rSVP.count({
      where: { eventId, status: 'GOING' },
    });
    const room = cap - going;
    if (room <= 0) break;

    const claimed = await tx.$queryRaw<{ userId: string }[]>`
      UPDATE "RSVP"
         SET status = 'GOING'::"RSVPStatus", "promotedAt" = now(), "updatedAt" = now()
       WHERE id IN (
         SELECT id FROM "RSVP"
          WHERE "eventId" = ${eventId} AND status = 'WAITLISTED'::"RSVPStatus"
          ORDER BY "createdAt" ASC
          LIMIT ${Math.min(room, batch)}
       )
      RETURNING "userId"
    `;
    if (claimed.length === 0) break;
    promoted.push(...claimed.map((row) => row.userId));
    if (claimed.length < batch) break; // queue drained
  }
  return promoted;
}

/**
 * Best-effort PROMOTION fan-out for users just moved off the wishlist.
 * Promotions are always delivered (opt-out does not apply). Never throws:
 * the promotion succeeds even if the notification write fails.
 */
export async function notifyPromotions(
  eventId: string,
  eventTitle: string,
  eventDate: Date,
  eventLocation: string,
  promotedUserIds: string[],
): Promise<void> {
  if (promotedUserIds.length === 0) return;
  try {
    await notifyUsers(
      promotedUserIds.map((userId) => ({
        userId,
        eventId,
        type: 'PROMOTION' as const,
        title: `You're in: ${eventTitle}`,
        body: `A spot opened up — ${formatEventDate(eventDate)} at ${eventLocation}.`,
      })),
    );
  } catch (error) {
    console.error('promotion notify fan-out failed', { eventId, error });
  }
}

/**
 * Shared DB core for setRsvp/joinWishlist/acceptInvite (same cap/waitlist
 * rules). Does no auth, redirect, revalidate or notification work: the
 * caller owns all of that. Takes `userId` explicitly so it can be driven
 * from a script without a session.
 */
export async function upsertRsvpCore(
  userId: string,
  eventId: string,
  status: SettableStatus,
  attendeeName?: string | null,
): Promise<UpsertRsvpOutcome> {
  return prisma.$transaction(
    async (tx) => {
      // Must be the first statement: everything below is a read-then-write
      // sequence that is only correct while this event is locked.
      await lockEvent(tx, eventId);

      const event = await tx.event.findUnique({ where: { id: eventId } });
      if (!event) return { ok: false as const, error: 'Event not found.' };
      if (event.date < new Date())
        return { ok: false as const, error: 'This event has ended.' };

      const existing = await tx.rSVP.findUnique({
        where: { userId_eventId: { userId, eventId } },
      });

      let target: RSVPStatus = status;
      if (status === 'GOING' && event.maxAttendees != null) {
        const going = await tx.rSVP.count({
          where: { eventId, status: 'GOING' },
        });
        const alreadyGoing = existing?.status === 'GOING';
        if (!alreadyGoing && going >= event.maxAttendees) {
          target = 'WAITLISTED';
        }
      }

      const row = await tx.rSVP.upsert({
        where: { userId_eventId: { userId, eventId } },
        create: {
          eventId,
          userId,
          status: target,
          attendeeName: attendeeName ?? null,
        },
        update: { status: target, attendeeName: attendeeName ?? null },
        select: { id: true, status: true, createdAt: true },
      });

      // Promote oldest waitlisted entries while GOING slots are free — this
      // covers switching away from GOING, which frees a seat. Safe because
      // the event lock above is still held.
      let promoted: string[] = [];
      if (event.maxAttendees != null) {
        promoted = await promoteFromWishlist(tx, eventId, event.maxAttendees);
      }

      let waitlistPosition: number | null = null;
      const finalRow =
        row.id && target === 'WAITLISTED'
          ? await tx.rSVP.findUnique({
              where: { id: row.id },
              select: { status: true, createdAt: true },
            })
          : null;
      // Re-read: promotion above may have moved this user to GOING.
      const finalStatus = finalRow?.status ?? target;
      if (finalStatus === 'WAITLISTED' && finalRow) {
        const ahead = await tx.rSVP.count({
          where: {
            eventId,
            status: 'WAITLISTED',
            createdAt: { lt: finalRow.createdAt },
          },
        });
        waitlistPosition = ahead + 1;
      }

      return {
        ok: true as const,
        status: finalStatus,
        waitlistPosition,
        promoted,
        eventTitle: event.title,
        eventDate: event.date,
        eventLocation: event.location,
      };
    },
    { timeout: 15_000 },
  );
}

/**
 * Shared DB core for cancelRsvp: removes the caller's RSVP row and promotes
 * the wishlist if a slot freed up. Returns the organizer's notify preference
 * so the caller can send the "someone left" notice.
 */
export async function cancelRsvpCore(
  userId: string,
  eventId: string,
): Promise<CancelRsvpOutcome> {
  return prisma.$transaction(
    async (tx) => {
      // Same per-event serialization as upsertRsvpCore: the delete and the
      // promotion that follows it must not interleave with another writer.
      await lockEvent(tx, eventId);

      const event = await tx.event.findUnique({ where: { id: eventId } });
      if (!event) return { ok: false as const, error: 'Event not found.' };

      const existing = await tx.rSVP.findUnique({
        where: { userId_eventId: { userId, eventId } },
        select: { id: true },
      });

      await tx.rSVP.deleteMany({ where: { eventId, userId } });

      let promoted: string[] = [];
      if (event.maxAttendees != null) {
        promoted = await promoteFromWishlist(tx, eventId, event.maxAttendees);
      }

      // Organizer's update/cancellation preference, if they hold an RSVP row.
      const organizerRsvp = await tx.rSVP.findUnique({
        where: { userId_eventId: { userId: event.userId, eventId } },
        select: { notifyOnUpdate: true },
      });

      return {
        ok: true as const,
        promoted,
        hadRsvp: existing !== null,
        eventTitle: event.title,
        eventDate: event.date,
        eventLocation: event.location,
        organizerId: event.userId,
        organizerNotify: organizerRsvp?.notifyOnUpdate ?? true,
      };
    },
    { timeout: 15_000 },
  );
}
