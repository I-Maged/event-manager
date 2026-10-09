import { connection } from 'next/server';
import { prisma } from '@/db';
import type { Event, RSVPStatus } from '@/generated/prisma';

export type RsvpCounts = Record<RSVPStatus, number>;

const EMPTY_COUNTS: RsvpCounts = {
  GOING: 0,
  NOT_GOING: 0,
  MAYBE: 0,
  WAITLISTED: 0,
};

/** Public, upcoming events ordered by date, optionally by one organizer. */
export async function getPublicUpcomingEvents(
  organizerUserId?: string,
): Promise<Event[]> {
  // Current-time filter: always render at request time.
  await connection();
  return prisma.event.findMany({
    where: {
      isPublic: true,
      date: { gte: new Date() },
      ...(organizerUserId ? { userId: organizerUserId } : {}),
    },
    orderBy: { date: 'asc' },
  });
}

/** Display name for an organizer's public events (null when unknown). */
export async function getOrganizerDisplayName(
  userId: string,
): Promise<string | null> {
  const row = await prisma.event.findFirst({
    where: { userId, isPublic: true, organizerName: { not: null } },
    select: { organizerName: true },
    orderBy: { createdAt: 'desc' },
  });
  return row?.organizerName ?? null;
}

/** GOING counts for a set of events in a single query (avoids N+1). */
export async function getGoingCounts(
  eventIds: string[],
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (eventIds.length === 0) return counts;
  const groups = await prisma.rSVP.groupBy({
    by: ['eventId'],
    where: { eventId: { in: eventIds }, status: 'GOING' },
    _count: { eventId: true },
  });
  for (const g of groups) counts.set(g.eventId, g._count.eventId);
  return counts;
}

export async function getEventById(id: string): Promise<Event | null> {
  return prisma.event.findUnique({ where: { id } });
}

export async function getRsvpCounts(eventId: string): Promise<RsvpCounts> {
  const groups = await prisma.rSVP.groupBy({
    by: ['status'],
    where: { eventId },
    _count: { status: true },
  });
  const counts: RsvpCounts = { ...EMPTY_COUNTS };
  for (const g of groups) counts[g.status] = g._count.status;
  return counts;
}

export async function getUserRsvpStatus(
  eventId: string,
  userId: string,
): Promise<RSVPStatus | null> {
  const rsvp = await prisma.rSVP.findUnique({
    where: { userId_eventId: { userId, eventId } },
    select: { status: true },
  });
  return rsvp?.status ?? null;
}

/** Caller's RSVP row with promotion flag (for the "You got in!" banner). */
export async function getUserRsvp(
  eventId: string,
  userId: string,
): Promise<{ status: RSVPStatus; promotedAt: Date | null } | null> {
  return prisma.rSVP.findUnique({
    where: { userId_eventId: { userId, eventId } },
    select: { status: true, promotedAt: true },
  });
}

/** Ordered wishlist queue (oldest first). No identities: userIds are opaque. */
export async function getWishlist(
  eventId: string,
): Promise<{ userId: string; createdAt: Date }[]> {
  return prisma.rSVP.findMany({
    where: { eventId, status: 'WAITLISTED' },
    orderBy: { createdAt: 'asc' },
    select: { userId: true, createdAt: true },
  });
}

export type WishlistEntry = {
  id: string;
  status: RSVPStatus;
  createdAt: Date;
  promotedAt: Date | null;
  waitlistPosition: number | null;
  event: Event;
};

/** Events the user wishlisted, each with its live queue position. */
export async function getUserWishlist(userId: string): Promise<WishlistEntry[]> {
  const rows = await prisma.rSVP.findMany({
    where: { userId, status: 'WAITLISTED' },
    include: { event: true },
    orderBy: { createdAt: 'asc' },
  });
  return Promise.all(
    rows.map(async (row) => ({
      id: row.id,
      status: row.status,
      createdAt: row.createdAt,
      promotedAt: row.promotedAt,
      waitlistPosition: await getWaitlistPosition(row.eventId, userId),
      event: row.event,
    })),
  );
}

/** Promoted rows whose banner hasn't been dismissed yet, with their events. */
export async function getUserPromotions(
  userId: string,
): Promise<{ id: string; promotedAt: Date; event: Event }[]> {
  const rows = await prisma.rSVP.findMany({
    where: { userId, status: 'GOING', promotedAt: { not: null } },
    include: { event: true },
    orderBy: { promotedAt: 'desc' },
  });
  return rows.map((row) => ({
    id: row.id,
    promotedAt: row.promotedAt as Date,
    event: row.event,
  }));
}

/** Waitlist position (1-based) of a user, ordered by RSVP creation time. */
export async function getWaitlistPosition(
  eventId: string,
  userId: string,
): Promise<number | null> {
  const entry = await prisma.rSVP.findUnique({
    where: { userId_eventId: { userId, eventId } },
    select: { status: true, createdAt: true },
  });
  if (!entry || entry.status !== 'WAITLISTED') return null;
  const ahead = await prisma.rSVP.count({
    where: {
      eventId,
      status: 'WAITLISTED',
      createdAt: { lt: entry.createdAt },
    },
  });
  return ahead + 1;
}

/**
 * Visibility rule: public events are visible to all; private events only to
 * the organizer or users holding any RSVP (including WAITLISTED).
 */
export async function canViewEvent(
  event: Event,
  userId: string | null,
): Promise<boolean> {
  if (event.isPublic) return true;
  if (!userId) return false;
  if (event.userId === userId) return true;
  const rsvp = await prisma.rSVP.findUnique({
    where: { userId_eventId: { userId, eventId: event.id } },
    select: { id: true },
  });
  return rsvp !== null;
}

export function spotsLeft(
  event: Event,
  goingCount: number,
): number | null {
  if (event.maxAttendees == null) return null;
  return Math.max(0, event.maxAttendees - goingCount);
}

export function formatEventDate(date: Date): string {
  return date.toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** Display name for stamping on events (null when identity has neither). */
export function resolveOrganizerName(user: {
  name?: string | null;
  email?: string | null;
} | null | undefined): string | null {
  const name = user?.name?.trim();
  if (name) return name.slice(0, 120);
  const email = user?.email?.trim();
  if (email) {
    const local = email.split('@')[0]?.trim();
    if (local) return local.slice(0, 120);
  }
  return null;
}

const ORGANIZER_ACCENTS = [
  'organizer-accent-0',
  'organizer-accent-1',
  'organizer-accent-2',
  'organizer-accent-3',
  'organizer-accent-4',
  'organizer-accent-5',
] as const;

/** Deterministic accent class per organizer (FNV-1a hash of the user id). */
export function organizerAccentClass(userId: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < userId.length; i++) {
    hash ^= userId.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return ORGANIZER_ACCENTS[Math.abs(hash) % ORGANIZER_ACCENTS.length];
}
