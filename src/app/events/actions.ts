'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { randomUUID } from 'crypto';
import { prisma } from '@/db';
import { auth } from '@/lib/auth/server';
import { formatEventDate, resolveOrganizerName } from '@/lib/events';
import { notifyUsers } from '@/lib/notifications';
import {
  SETTABLE_STATUSES,
  cancelRsvpCore,
  notifyPromotions,
  upsertRsvpCore,
  type RsvpResult,
  type SettableStatus as SettableStatusCore,
  type UpsertRsvpOutcome,
} from '@/lib/rsvp';

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
          body: `${name} is no longer attending — ${formatEventDate(result.eventDate)} at ${result.eventLocation}.`,
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

export type InviteLinkResult =
  | { ok: true; token: string }
  | { ok: false; error: string };

function newInviteToken(): string {
  return randomUUID().replace(/-/g, '');
}

/**
 * Reusable invite link for a private event. Idempotent: returns the existing
 * token when one is already active so refreshes don't invalidate shared links.
 */
export async function createInviteLink(
  eventId: string,
): Promise<InviteLinkResult> {
  await requireOrganizer(eventId);
  const existing = await prisma.event.findUnique({
    where: { id: eventId },
    select: { inviteToken: true, isPublic: true },
  });
  if (!existing) return { ok: false, error: 'Event not found.' };
  if (existing.isPublic) {
    return { ok: false, error: 'Public events do not need invite links.' };
  }
  if (existing.inviteToken) return { ok: true, token: existing.inviteToken };
  const token = newInviteToken();
  await prisma.event.update({ where: { id: eventId }, data: { inviteToken: token } });
  revalidateEvent(eventId);
  return { ok: true, token };
}

/** Replace the active invite link (invalidates the previously shared URL). */
export async function regenerateInviteLink(
  eventId: string,
): Promise<InviteLinkResult> {
  await requireOrganizer(eventId);
  const existing = await prisma.event.findUnique({
    where: { id: eventId },
    select: { id: true, isPublic: true },
  });
  if (!existing) return { ok: false, error: 'Event not found.' };
  if (existing.isPublic) {
    return { ok: false, error: 'Public events do not need invite links.' };
  }
  const token = newInviteToken();
  await prisma.event.update({ where: { id: eventId }, data: { inviteToken: token } });
  revalidateEvent(eventId);
  return { ok: true, token };
}

/** Revoke the invite link (previously shared URLs stop working). Idempotent. */
export async function revokeInviteLink(
  eventId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireOrganizer(eventId);
  const existing = await prisma.event.findUnique({
    where: { id: eventId },
    select: { id: true },
  });
  if (!existing) return { ok: false, error: 'Event not found.' };
  await prisma.event.update({ where: { id: eventId }, data: { inviteToken: null } });
  revalidateEvent(eventId);
  return { ok: true };
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
  const event = await prisma.event.findUnique({
    where: { inviteToken: token },
  });
  if (!event) return { ok: false, error: 'This invite link is invalid or revoked.' };
  if (event.date < new Date()) {
    return { ok: false, error: 'This event has ended.' };
  }
  if (event.userId === userId) {
    return { ok: false, error: 'You are hosting this event.', eventId: event.id };
  }
  const result = await finishRsvp(
    event.id,
    await upsertRsvpCore(userId, event.id, 'GOING', attendeeName),
  );
  if (!result.ok) return result;
  return { ...result, eventId: event.id };
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
  await requireOrganizer(eventId);
  try {
    const rsvp = await prisma.rSVP.findUnique({
      where: { userId_eventId: { userId: attendeeUserId, eventId } },
      select: { id: true, status: true, checkedInAt: true },
    });
    if (!rsvp) return { ok: false, error: 'Attendee not found.' };
    if (rsvp.status !== 'GOING') {
      return { ok: false, error: 'Only Going attendees can be checked in.' };
    }
    if (rsvp.checkedInAt)
      return { ok: true, checkedInAt: rsvp.checkedInAt.toISOString() };
    const updated = await prisma.rSVP.update({
      where: { id: rsvp.id },
      data: { checkedInAt: new Date() },
      select: { checkedInAt: true },
    });
    revalidateEvent(eventId);
    return { ok: true, checkedInAt: updated.checkedInAt?.toISOString() ?? null };
  } catch (error) {
    console.error('checkInAttendee failed', { eventId, attendeeUserId, error });
    return { ok: false, error: 'Check-in failed. Please retry.' };
  }
}

/** Undo a check-in. Organizer-only, idempotent. */
export async function undoCheckIn(
  eventId: string,
  attendeeUserId: string,
): Promise<CheckInResult> {
  await requireOrganizer(eventId);
  try {
    const rsvp = await prisma.rSVP.findUnique({
      where: { userId_eventId: { userId: attendeeUserId, eventId } },
      select: { id: true, checkedInAt: true },
    });
    if (!rsvp) return { ok: false, error: 'Attendee not found.' };
    if (!rsvp.checkedInAt) return { ok: true, checkedInAt: null };
    const updated = await prisma.rSVP.update({
      where: { id: rsvp.id },
      data: { checkedInAt: null },
      select: { checkedInAt: true },
    });
    revalidateEvent(eventId);
    return { ok: true, checkedInAt: updated.checkedInAt?.toISOString() ?? null };
  } catch (error) {
    console.error('undoCheckIn failed', { eventId, attendeeUserId, error });
    return { ok: false, error: 'Undo check-in failed. Please retry.' };
  }
}
