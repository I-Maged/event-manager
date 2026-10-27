'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { prisma } from '@/db';
import { auth } from '@/lib/auth/server';
import { resolveOrganizerName } from '@/lib/events';
import {
  acceptInviteCore,
  createInviteLinkCore,
  regenerateInviteLinkCore,
  revokeInviteLinkCore,
  type InviteLinkResult as InviteLinkCoreResult,
} from '@/lib/invite';
import { checkInAttendeeCore, undoCheckInCore } from '@/lib/check-in';
import { notifyUsers } from '@/lib/notifications';
import { enforceRateLimit } from '@/lib/rate-limit';
import {
  SETTABLE_STATUSES,
  cancelRsvpCore,
  notifyPromotions,
  upsertRsvpCore,
  type RsvpResult,
  type SettableStatus as SettableStatusCore,
  type UpsertRsvpOutcome,
} from '@/lib/rsvp';
import { formatEventDate } from '@/lib/time';

// Re-exported as local aliases (not `export … from`) so the client-facing
// type surface of this 'use server' module is unchanged.
export type SettableStatus = SettableStatusCore;
export type SetRsvpResult = RsvpResult;

async function requireUserId(): Promise<string> {
  const { data: session } = await auth.getSession();
  const userId = session?.user?.id;
  if (!userId) redirect('/auth/sign-in');
  return userId;
}

async function requireUser(): Promise<{ userId: string; attendeeName: string | null }> {
  const { data: session } = await auth.getSession();
  const userId = session?.user?.id;
  if (!userId) redirect('/auth/sign-in');
  return { userId, attendeeName: resolveOrganizerName(session?.user) };
}

async function requireOrganizer(eventId: string): Promise<string> {
  const { data: session } = await auth.getSession();
  const userId = session?.user?.id;
  if (!userId) redirect('/auth/sign-in');
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { userId: true },
  });
  if (!event || event.userId !== userId) redirect('/events');
  return userId;
}

function revalidateEvent(eventId: string) {
  revalidatePath(`/events/${eventId}`);
  revalidatePath('/events');
  revalidatePath('/wishlist');
}

/**
 * Revalidate + best-effort PROMOTION fan-out shared by every caller of the
 * upsert core, then narrow the core outcome to the client-facing result.
 */
async function finishRsvp(
  eventId: string,
  outcome: UpsertRsvpOutcome,
): Promise<SetRsvpResult> {
  if (!outcome.ok) return { ok: false, error: outcome.error };
  revalidateEvent(eventId);
  if (outcome.promoted.length > 0) {
    await notifyPromotions(
      eventId,
      outcome.eventTitle,
      outcome.eventDate,
      outcome.eventLocation,
      outcome.promoted,
      outcome.eventTimeZone,
    );
    revalidatePath('/notifications');
  }
  return {
    ok: true,
    status: outcome.status,
    waitlistPosition: outcome.waitlistPosition,
  };
}

/**
 * Upsert the caller's RSVP. GOING past a full cap becomes WAITLISTED.
 * Every RSVP mutation for an event is serialized by a Postgres advisory
 * lock taken as the first statement of `upsertRsvpCore`'s transaction, so a
 * concurrent GOING click cannot overbook the cap and a waitlisted row
 * cannot be double-promoted. After freeing a GOING slot, the oldest
 * WAITLISTED entries are promoted.
 */
export async function setRsvp(
  eventId: string,
  status: SettableStatus,
): Promise<SetRsvpResult> {
  if (!SETTABLE_STATUSES.includes(status)) {
    return { ok: false, error: 'Invalid RSVP status.' };
  }
  const { userId, attendeeName } = await requireUser();
  const limited = await enforceRateLimit('rsvp', userId);
  if (limited) return limited;
  return finishRsvp(
    eventId,
    await upsertRsvpCore(userId, eventId, status, attendeeName),
  );
}

/**
 * Explicit wishlist entry point for capped events. Behaves like choosing
 * Going (a free slot means joining outright), but rejects uncapped events
 * where a wishlist is meaningless.
 */
export async function joinWishlist(eventId: string): Promise<SetRsvpResult> {
  const { userId, attendeeName } = await requireUser();
  const limited = await enforceRateLimit('rsvp', userId);
  if (limited) return limited;
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { maxAttendees: true, date: true },
  });
  if (!event) return { ok: false, error: 'Event not found.' };
  if (event.maxAttendees == null) {
    return { ok: false, error: 'This event has open spots — choose Going instead.' };
  }
  if (event.date < new Date()) {
    return { ok: false, error: 'This event has ended.' };
  }
  return finishRsvp(
    eventId,
    await upsertRsvpCore(userId, eventId, 'GOING', attendeeName),
  );
}

/** Remove the caller's RSVP entirely, promoting the wishlist if needed. */
export async function cancelRsvp(
  eventId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { userId, attendeeName } = await requireUser();
  const limited = await enforceRateLimit('rsvp', userId);
  if (limited) return limited;

  const result = await cancelRsvpCore(userId, eventId);

  if (!result.ok) return result;
  revalidateEvent(eventId);

  let notified = false;
  if (result.promoted.length > 0) {
    await notifyPromotions(
      eventId,
      result.eventTitle,
      result.eventDate,
      result.eventLocation,
      result.promoted,
      result.eventTimeZone,
    );
    notified = true;
  }

  // Tell the organizer someone left (opt-out respected). Skipped when the
  // caller had no RSVP row or is the organizer themselves.
  if (
    result.hadRsvp &&
    result.organizerId !== userId &&
    result.organizerNotify
  ) {
    try {
      const name = attendeeName ?? 'An attendee';
      await notifyUsers([
        {
          userId: result.organizerId,
          eventId,
          type: 'EVENT_CANCELLED' as const,
          title: `${name} left ${result.eventTitle}`,
          body: `${name} is no longer attending — ${formatEventDate(result.eventDate, result.eventTimeZone)} at ${result.eventLocation}.`,
        },
      ]);
      notified = true;
    } catch (error) {
      console.error('cancel notify fan-out failed', { eventId, error });
    }
  }

  if (notified) revalidatePath('/notifications');
  return { ok: true };
}

/** Dismiss the "You got in!" banner for the caller's row. Idempotent. */
export async function dismissPromotion(
  eventId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const userId = await requireUserId();
  await prisma.rSVP.updateMany({
    where: { eventId, userId, promotedAt: { not: null } },
    data: { promotedAt: null },
  });
  revalidateEvent(eventId);
  return { ok: true };
}

/**
 * Toggle in-app update/reminder notifications for the caller's RSVP.
 * No-op when the caller has no RSVP row. Does not affect promotions
 * or comments, which are always delivered. Event updates, event
 * cancellations, and single-user cancel notices respect this setting.
 */
export async function setNotifyOnUpdate(
  eventId: string,
  value: boolean,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const userId = await requireUserId();
  await prisma.rSVP.updateMany({
    where: { eventId, userId },
    data: { notifyOnUpdate: value },
  });
  revalidateEvent(eventId);
  return { ok: true };
}

export type InviteLinkResult = InviteLinkCoreResult;

/**
 * Reusable invite link for a private event. Idempotent: returns the existing
 * token when one is already active so refreshes don't invalidate shared links.
 */
export async function createInviteLink(
  eventId: string,
): Promise<InviteLinkResult> {
  const userId = await requireOrganizer(eventId);
  const limited = await enforceRateLimit('invite', userId);
  if (limited) return limited;
  const result = await createInviteLinkCore(eventId);
  if (result.ok) revalidateEvent(eventId);
  return result;
}

/** Replace the active invite link (invalidates the previously shared URL). */
export async function regenerateInviteLink(
  eventId: string,
): Promise<InviteLinkResult> {
  const userId = await requireOrganizer(eventId);
  const limited = await enforceRateLimit('invite', userId);
  if (limited) return limited;
  const result = await regenerateInviteLinkCore(eventId);
  if (result.ok) revalidateEvent(eventId);
  return result;
}

/** Revoke the invite link (previously shared URLs stop working). Idempotent. */
export async function revokeInviteLink(
  eventId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const userId = await requireOrganizer(eventId);
  const limited = await enforceRateLimit('invite', userId);
  if (limited) return limited;
  const result = await revokeInviteLinkCore(eventId);
  if (result.ok) revalidateEvent(eventId);
  return result;
}

/**
 * Accept a reusable invite link. Creates a GOING RSVP (falling back to
 * WAITLISTED when the cap is full) so the private event becomes visible via
 * the existing canViewEvent rule.
 */
export async function acceptInvite(
  token: string,
): Promise<SetRsvpResult & { eventId?: string }> {
  const { userId, attendeeName } = await requireUser();
  const limited = await enforceRateLimit('accept', userId);
  if (limited) return limited;

  const accepted = await acceptInviteCore(userId, attendeeName, token);
  if (!accepted.ok) {
    return accepted.eventId
      ? { ok: false, error: accepted.error, eventId: accepted.eventId }
      : { ok: false, error: accepted.error };
  }

  const result = await finishRsvp(accepted.eventId, accepted.rsvp);
  return result.ok ? { ...result, eventId: accepted.eventId } : result;
}

export type CheckInResult =
  | { ok: true; checkedInAt: string | null }
  | { ok: false; error: string };

/**
 * Check in a GOING attendee. Organizer-only, idempotent. No time-window
 * enforcement (v1): organizers can check in before/after the event.
 * Never throws for DB failures: returns { ok: false } so the client can
 * revert optimistic UI instead of surfacing an uncaught ErrorEvent.
 */
export async function checkInAttendee(
  eventId: string,
  attendeeUserId: string,
): Promise<CheckInResult> {
  const organizerId = await requireOrganizer(eventId);
  const limited = await enforceRateLimit('checkIn', organizerId);
  if (limited) return limited;

  const result = await checkInAttendeeCore(eventId, attendeeUserId, organizerId);
  if (!result.ok) return result;
  revalidateEvent(eventId);
  return { ok: true, checkedInAt: result.checkedInAt };
}

/** Undo a check-in. Organizer-only, idempotent. */
export async function undoCheckIn(
  eventId: string,
  attendeeUserId: string,
): Promise<CheckInResult> {
  const organizerId = await requireOrganizer(eventId);
  const limited = await enforceRateLimit('checkIn', organizerId);
  if (limited) return limited;

  const result = await undoCheckInCore(eventId, attendeeUserId, organizerId);
  if (!result.ok) return result;
  revalidateEvent(eventId);
  return { ok: true, checkedInAt: result.checkedInAt };
}
