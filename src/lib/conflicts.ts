import { prisma } from '@/db';
import type { Prisma } from '@/generated/prisma';
import { CALENDAR_EVENT_DURATION_MS } from '@/lib/calendar';

export type ConflictEvent = {
  id: string;
  title: string;
  date: Date;
  timeZone: string | null;
};

type Client = Prisma.TransactionClient | typeof prisma;

export function eventsOverlap(
  aStart: Date,
  bStart: Date,
  durationMs: number = CALENDAR_EVENT_DURATION_MS,
): boolean {
  const a = aStart.getTime();
  const b = bStart.getTime();
  return a < b + durationMs && b < a + durationMs;
}

export async function findConflictingGoingEvents(
  userId: string,
  eventId: string,
  eventDate: Date,
  client: Client = prisma,
): Promise<ConflictEvent[]> {
  const duration = CALENDAR_EVENT_DURATION_MS;
  const lower = new Date(eventDate.getTime() - duration);
  const upper = new Date(eventDate.getTime() + duration);

  const [rsvps, owned] = await Promise.all([
    client.rSVP.findMany({
      where: {
        userId,
        status: 'GOING',
        eventId: { not: eventId },
        event: { date: { gt: lower, lt: upper } },
      },
      select: { event: { select: { id: true, title: true, date: true, timeZone: true } } },
    }),
    client.event.findMany({
      where: {
        userId,
        id: { not: eventId },
        date: { gt: lower, lt: upper },
      },
      select: { id: true, title: true, date: true, timeZone: true },
    }),
  ]);

  const seen = new Set<string>();
  const result: ConflictEvent[] = [];
  const candidates: ConflictEvent[] = [
    ...rsvps.map((r) => r.event),
    ...owned,
  ];
  for (const c of candidates) {
    if (seen.has(c.id)) continue;
    if (!eventsOverlap(eventDate, c.date)) continue;
    seen.add(c.id);
    result.push(c);
  }
  result.sort((a, b) => a.date.getTime() - b.date.getTime());
  return result;
}
