'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { randomUUID } from 'crypto';
import { prisma } from '@/db';
import type { Prisma, RSVPStatus } from '@/generated/prisma';
import { auth } from '@/lib/auth/server';
import { resolveOrganizerName } from '@/lib/events';

type Tx = Prisma.TransactionClient;

const SETTABLE_STATUSES = ['GOING', 'MAYBE', 'NOT_GOING'] as const;
export type SettableStatus = (typeof SETTABLE_STATUSES)[number];

export type SetRsvpResult =
  | { ok: true; status: RSVPStatus; waitlistPosition: number | null }
  | { ok: false; error: string };

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
 * Fill free GOING slots from the wishlist (oldest first), flagging each
 * promoted row so the UI can show a "You got in!" banner.
 */
async function promoteFromWishlist(
  tx: Tx,
  eventId: string,
  cap: number,
): Promise<void> {
  let going = await tx.rSVP.count({
    where: { eventId, status: 'GOING' },
  });
  while (going < cap) {
    const next = await tx.rSVP.findFirst({
      where: { eventId, status: 'WAITLISTED' },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (!next) break;
    await tx.rSVP.update({
      where: { id: next.id },
      data: { status: 'GOING', promotedAt: new Date() },
    });
    going += 1;
  }
}

/** Shared upsert core for setRsvp and joinWishlist (same cap/waitlist rules). */
async function upsertRsvp(
  userId: string,
  eventId: string,
  status: SettableStatus,
  attendeeName?: string | null,
): Promise<SetRsvpResult> {
  const result = await prisma.$transaction(async (tx) => {
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
      create: { eventId, userId, status: target, attendeeName: attendeeName ?? null },
      update: { status: target, attendeeName: attendeeName ?? null },
      select: { id: true, status: true, createdAt: true },
    });

    // Promote oldest waitlisted entries while GOING slots are free
    // (covers leaving the GOING pool and capacity increases via edit).
    if (event.maxAttendees != null) {
      await promoteFromWishlist(tx, eventId, event.maxAttendees);
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

    return { ok: true as const, status: finalStatus, waitlistPosition };
  });

  if (result.ok) revalidateEvent(eventId);
  return result;
}

/**
 * Upsert the caller's RSVP. GOING past a full cap becomes WAITLISTED.
 * Runs in a transaction so concurrent GOING clicks cannot overbook.
 * After freeing a GOING slot, the oldest WAITLISTED entry is promoted.
 */
export async function setRsvp(
  eventId: string,
  status: SettableStatus,
): Promise<SetRsvpResult> {
  if (!SETTABLE_STATUSES.includes(status)) {
    return { ok: false, error: 'Invalid RSVP status.' };
  }
  const { userId, attendeeName } = await requireUser();
  return upsertRsvp(userId, eventId, status, attendeeName);
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
  return upsertRsvp(userId, eventId, 'GOING', attendeeName);
}

/** Remove the caller's RSVP entirely, promoting the wishlist if needed. */
export async function cancelRsvp(
  eventId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const userId = await requireUserId();

  const result = await prisma.$transaction(async (tx) => {
    const event = await tx.event.findUnique({ where: { id: eventId } });
    if (!event) return { ok: false as const, error: 'Event not found.' };

    await tx.rSVP.deleteMany({ where: { eventId, userId } });

    if (event.maxAttendees != null) {
      await promoteFromWishlist(tx, eventId, event.maxAttendees);
    }
    return { ok: true as const };
  });

  if (result.ok) revalidateEvent(eventId);
  return result;
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
 * or comments, which are always delivered.
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
  const result = await upsertRsvp(userId, event.id, 'GOING', attendeeName);
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
