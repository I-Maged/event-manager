import { prisma } from '@/db';
import type { Event, RSVPStatus } from '@/generated/prisma';
import { notifyUsers } from '@/lib/notifications';
import { formatEventDate } from '@/lib/time';

/**
 * Recipient selection + best-effort fan-out for event-related notifications.
 *
 * Extracted from the server actions so the recipient rules (opt-out, organizer
 * exclusion, comment cap, dedupe) can be tested against the database without a
 * Neon Auth session. Nothing here calls `revalidatePath`, so callers stay in
 * charge of request-scoped cache invalidation.
 */

export const NOTIFY_RECIPIENT_CAP = 20;

/** Statuses that make a user a "holder" of an event. */
export const EVENT_HOLDER_STATUSES = [
  'GOING',
  'MAYBE',
  'WAITLISTED',
] as const satisfies readonly RSVPStatus[];

export type EventChangeSnapshot = Pick<Event, 'title' | 'date' | 'location'>;

/**
 * Opted-in holders of an event, excluding the organizer. Used by both the
 * EVENT_UPDATED fan-out and (pre-delete) the EVENT_CANCELLED fan-out.
 */
export async function selectEventUpdateRecipients(
  eventId: string,
  organizerId: string,
): Promise<string[]> {
  const holders = await prisma.rSVP.findMany({
    where: {
      eventId,
      status: { in: [...EVENT_HOLDER_STATUSES] },
      notifyOnUpdate: true,
      NOT: { userId: organizerId },
    },
    select: { userId: true },
  });
  return holders.map((holder) => holder.userId);
}

/** Human-readable diff lines; empty when nothing worth notifying changed. */
export function eventChangeLines(
  before: EventChangeSnapshot,
  after: EventChangeSnapshot,
  timeZone: string | null,
): string[] {
  const lines: string[] = [];
  if (after.title !== before.title) {
    lines.push(`Title is now “${after.title}”`);
  }
  if (after.location !== before.location) {
    lines.push(`Location is now ${after.location}`);
  }
  if (after.date.getTime() !== before.date.getTime()) {
    lines.push(`Date is now ${formatEventDate(after.date, timeZone)}`);
  }
  return lines;
}

/**
 * Best-effort EVENT_UPDATED fan-out. Only fires when title/date/location
 * changed, only to opted-in GOING/MAYBE/WAITLISTED holders, never to the
 * organizer. Returns the number of notifications written (0 on no-op/failure).
 */
export async function notifyEventUpdated(input: {
  eventId: string;
  organizerId: string;
  before: EventChangeSnapshot;
  after: EventChangeSnapshot;
  timeZone: string | null;
}): Promise<number> {
  const changeLines = eventChangeLines(input.before, input.after, input.timeZone);
  if (changeLines.length === 0) return 0;

  try {
    const recipients = await selectEventUpdateRecipients(
      input.eventId,
      input.organizerId,
    );
    if (recipients.length === 0) return 0;
    await notifyUsers(
      recipients.map((userId) => ({
        userId,
        eventId: input.eventId,
        type: 'EVENT_UPDATED' as const,
        title: `Event updated: ${input.after.title}`,
        body: changeLines.join(' · '),
      })),
    );
    return recipients.length;
  } catch (error) {
    console.error('event update notify fan-out failed', {
      eventId: input.eventId,
      error,
    });
    return 0;
  }
}

export type CancelledEventSnapshot = Pick<
  Event,
  'title' | 'date' | 'timeZone' | 'location' | 'userId'
>;

/**
 * Best-effort EVENT_CANCELLED fan-out. `recipients` must be captured *before*
 * the event is deleted (the delete cascades RSVPs). Notices use `eventId: null`
 * so they survive the cascade and never link to a dead event.
 */
export async function notifyEventCancelled(input: {
  eventId: string;
  event: CancelledEventSnapshot;
  recipients: string[];
}): Promise<number> {
  if (input.recipients.length === 0) return 0;
  try {
    await notifyUsers(
      input.recipients.map((userId) => ({
        userId,
        eventId: null,
        type: 'EVENT_CANCELLED' as const,
        title: `Event cancelled: ${input.event.title}`,
        body: `${formatEventDate(input.event.date, input.event.timeZone)} at ${input.event.location} will not take place.`,
      })),
    );
    return input.recipients.length;
  } catch (error) {
    console.error('event cancel notify fan-out failed', {
      eventId: input.eventId,
      error,
    });
    return 0;
  }
}

/**
 * Comment recipients: the organizer first (unless they wrote the comment),
 * then distinct prior commenters, capped at `NOTIFY_RECIPIENT_CAP`.
 */
export async function selectCommentRecipients(
  eventId: string,
  organizerId: string,
  authorId: string,
): Promise<string[]> {
  const prior = await prisma.comment.findMany({
    where: { eventId, NOT: { userId: authorId } },
    select: { userId: true },
    distinct: ['userId'],
    take: NOTIFY_RECIPIENT_CAP,
  });

  const recipients = new Set<string>();
  if (organizerId !== authorId) recipients.add(organizerId);
  for (const row of prior) {
    if (row.userId !== authorId) recipients.add(row.userId);
    if (recipients.size >= NOTIFY_RECIPIENT_CAP) break;
  }
  return [...recipients];
}

/**
 * Best-effort COMMENT fan-out for a just-created comment. Returns the number
 * of notifications written (0 on no-op/failure).
 */
export async function notifyNewComment(input: {
  eventId: string;
  eventTitle: string;
  organizerId: string;
  authorId: string;
  body: string;
}): Promise<number> {
  try {
    const recipients = await selectCommentRecipients(
      input.eventId,
      input.organizerId,
      input.authorId,
    );
    if (recipients.length === 0) return 0;
    await notifyUsers(
      recipients.map((userId) => ({
        userId,
        eventId: input.eventId,
        type: 'COMMENT' as const,
        title: `New comment on ${input.eventTitle}`,
        body: input.body.slice(0, 140),
      })),
    );
    return recipients.length;
  } catch (error) {
    console.error('comment notify fan-out failed', {
      eventId: input.eventId,
      error,
    });
    return 0;
  }
}
