import { randomUUID } from 'crypto';
import { prisma } from '@/db';
import { upsertRsvpCore, type UpsertRsvpOutcome } from '@/lib/rsvp';

/**
 * Reusable invite-link DB cores.
 *
 * These do no auth, redirect, revalidate or notification work: the server
 * actions own that. Keeping them request-free lets DB integration tests drive
 * the idempotent-claim and accept paths directly, without mocking Neon Auth.
 */

export type InviteLinkResult =
  | { ok: true; token: string }
  | { ok: false; error: string };

/** Fresh, URL-safe token (32 hex chars, no dashes). */
export function newInviteToken(): string {
  return randomUUID().replace(/-/g, '');
}

/**
 * Reusable invite link for a private event. Idempotent: returns the existing
 * token when one is already active so refreshes don't invalidate shared links.
 */
export async function createInviteLinkCore(
  eventId: string,
): Promise<InviteLinkResult> {
  const existing = await prisma.event.findUnique({
    where: { id: eventId },
    select: { inviteToken: true, isPublic: true },
  });
  if (!existing) return { ok: false, error: 'Event not found.' };
  if (existing.isPublic) {
    return { ok: false, error: 'Public events do not need invite links.' };
  }
  if (existing.inviteToken) return { ok: true, token: existing.inviteToken };

  // Claim the empty token in one conditional write. Two concurrent callers can
  // both observe `inviteToken === null`; the loser's update matches zero rows
  // (the row lock makes it re-evaluate the predicate after the winner commits)
  // and re-reads the winner's token instead of silently invalidating it.
  const token = newInviteToken();
  const claimed = await prisma.event.updateMany({
    where: { id: eventId, inviteToken: null, isPublic: false },
    data: { inviteToken: token },
  });

  if (claimed.count === 0) {
    // Another request won the race, or the event changed under us.
    const current = await prisma.event.findUnique({
      where: { id: eventId },
      select: { inviteToken: true, isPublic: true },
    });
    if (!current) return { ok: false, error: 'Event not found.' };
    if (current.isPublic) {
      return { ok: false, error: 'Public events do not need invite links.' };
    }
    if (current.inviteToken) return { ok: true, token: current.inviteToken };
    return { ok: false, error: 'Could not create an invite link. Please retry.' };
  }

  return { ok: true, token };
}

/** Replace the active invite link (invalidates the previously shared URL). */
export async function regenerateInviteLinkCore(
  eventId: string,
): Promise<InviteLinkResult> {
  const existing = await prisma.event.findUnique({
    where: { id: eventId },
    select: { id: true, isPublic: true },
  });
  if (!existing) return { ok: false, error: 'Event not found.' };
  if (existing.isPublic) {
    return { ok: false, error: 'Public events do not need invite links.' };
  }
  const token = newInviteToken();
  await prisma.event.update({
    where: { id: eventId },
    data: { inviteToken: token },
  });
  return { ok: true, token };
}

/** Revoke the invite link (previously shared URLs stop working). Idempotent. */
export async function revokeInviteLinkCore(
  eventId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const existing = await prisma.event.findUnique({
    where: { id: eventId },
    select: { id: true },
  });
  if (!existing) return { ok: false, error: 'Event not found.' };
  await prisma.event.update({
    where: { id: eventId },
    data: { inviteToken: null },
  });
  return { ok: true };
}

export type AcceptedInviteRsvp = Extract<UpsertRsvpOutcome, { ok: true }>;

export type AcceptInviteOutcome =
  | { ok: true; eventId: string; rsvp: AcceptedInviteRsvp }
  | { ok: false; error: string; eventId?: string };

/**
 * Accept a reusable invite link. Creates a GOING RSVP (falling back to
 * WAITLISTED when the cap is full) so the private event becomes visible via
 * the existing canViewEvent rule.
 */
export async function acceptInviteCore(
  userId: string,
  attendeeName: string | null,
  token: string,
): Promise<AcceptInviteOutcome> {
  const event = await prisma.event.findUnique({ where: { inviteToken: token } });
  if (!event) {
    return { ok: false, error: 'This invite link is invalid or revoked.' };
  }
  if (event.date < new Date()) {
    return { ok: false, error: 'This event has ended.' };
  }
  if (event.userId === userId) {
    return { ok: false, error: 'You are hosting this event.', eventId: event.id };
  }

  const rsvp = await upsertRsvpCore(userId, event.id, 'GOING', attendeeName);
  if (!rsvp.ok) return { ok: false, error: rsvp.error };
  return { ok: true, eventId: event.id, rsvp };
}
