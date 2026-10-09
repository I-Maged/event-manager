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

/** Public, upcoming events ordered by date. */
export async function getPublicUpcomingEvents(): Promise<Event[]> {
  // Current-time filter: always render at request time.
  await connection();
  return prisma.event.findMany({
    where: { isPublic: true, date: { gte: new Date() } },
    orderBy: { date: 'asc' },
  });
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
