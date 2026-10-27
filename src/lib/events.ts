import { cache } from 'react';
import { connection } from 'next/server';
import { prisma } from '@/db';
import type {
  Event,
  EventCategory,
  Prisma,
  RSVPStatus,
} from '@/generated/prisma';
import { EVENT_CATEGORIES } from '@/lib/categories';
import type { EventListParams, SortOrder, WhenFilter } from '@/lib/discovery';
import { escapeLikePattern } from '@/lib/search';
import { addDaysInZone, calendarDayDiffInZone } from '@/lib/time';

// Backwards-compatible module surface: `formatEventDate` moved to `@/lib/time`
// when timezone support landed, and a few callers may still import it here.
export { formatEventDate } from '@/lib/time';

export type RsvpCounts = Record<RSVPStatus, number>;

const EMPTY_COUNTS: RsvpCounts = {
  GOING: 0,
  NOT_GOING: 0,
  MAYBE: 0,
  WAITLISTED: 0,
};

/**
 * Request-free core for the public "upcoming" query. `now` is injectable so
 * tests can pin the current-time filter without fake timers.
 */
export async function getPublicUpcomingEventsCore(
  organizerUserId?: string,
  now: Date = new Date(),
): Promise<Event[]> {
  return prisma.event.findMany({
    where: {
      isPublic: true,
      date: { gte: now },
      ...(organizerUserId ? { userId: organizerUserId } : {}),
    },
    orderBy: { date: 'asc' },
  });
}

/** Public, upcoming events ordered by date, optionally by one organizer. */
export async function getPublicUpcomingEvents(
  organizerUserId?: string,
): Promise<Event[]> {
  // Current-time filter: always render at request time.
  await connection();
  return getPublicUpcomingEventsCore(organizerUserId);
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

/** Page size for the public browse grid. */
export const PAGE_SIZE = 12;

export type PublicEventsPage = {
  events: Event[];
  total: number;
  page: number;
  pageCount: number;
};

/**
 * Date range for a `when` filter. Always floored at `now` so already-started
 * events never show as upcoming; upper bounds are anchored to the start of a
 * calendar day in `APP_TIME_ZONE`, so the window is stable within a day.
 *
 * Browse day boundaries are deliberately app-wide rather than per-event:
 * filtering by "today" across events authored in different zones needs one
 * reference clock, and `APP_TIME_ZONE` is that clock.
 */
function whenDateRange(when: WhenFilter, now: Date): Prisma.DateTimeFilter {
  if (when === 'any') return { gte: now };
  const days = when === 'today' ? 1 : when === 'week' ? 7 : 30;
  return { gte: now, lt: addDaysInZone(now, days) };
}

/** Deterministic ordering; `id` is always the final tiebreaker. */
function publicEventOrderBy(
  sort: SortOrder,
): Prisma.EventOrderByWithRelationInput[] {
  switch (sort) {
    case 'newest':
      return [{ createdAt: 'desc' }, { id: 'asc' }];
    case 'popular':
      // Approximate popularity: total RSVPs (any status). Prisma can order by a
      // to-many relation's count but cannot filter the counted relation.
      return [{ rsvps: { _count: 'desc' } }, { id: 'asc' }];
    case 'date':
    default:
      return [{ date: 'asc' }, { id: 'asc' }];
  }
}

/**
 * Case-insensitive free-text search across the fields shown on a card.
 * User input is escaped so `%` and `_` match literally instead of acting as
 * SQL LIKE wildcards (the value is still parameterized, never interpolated).
 */
function searchFilter(q: string): Prisma.EventWhereInput {
  const contains = {
    contains: escapeLikePattern(q),
    mode: 'insensitive' as const,
  };
  return {
    OR: [
      { title: contains },
      { description: contains },
      { location: contains },
      { organizerName: contains },
    ],
  };
}

/**
 * Request-free core for the browse page query. Callers that need
 * request-time rendering call `getPublicEventsPage` instead.
 */
export async function getPublicEventsPageCore(
  params: EventListParams,
  now: Date = new Date(),
): Promise<PublicEventsPage> {
  const where: Prisma.EventWhereInput = {
    isPublic: true,
    date: whenDateRange(params.when, now),
    ...(params.category ? { category: params.category } : {}),
    ...(params.organizer ? { userId: params.organizer } : {}),
    ...(params.q ? searchFilter(params.q) : {}),
  };

  // One snapshot for the count and the page: at READ COMMITTED a concurrent
  // write could make `total`/`pageCount` disagree with the returned rows (and
  // the page clamp derive from the stale total).
  return prisma.$transaction(
    async (tx) => {
      const total = await tx.event.count({ where });
      const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
      const page = Math.min(Math.max(params.page, 1), pageCount);

      const events = await tx.event.findMany({
        where,
        orderBy: publicEventOrderBy(params.sort),
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
      });

      return { events, total, page, pageCount };
    },
    { isolationLevel: 'RepeatableRead' },
  );
}

/**
 * One page of public, upcoming events matching the browse filters, plus the
 * total needed for pagination. `page` is clamped so an out-of-range URL still
 * renders the last page instead of an empty grid.
 */
export async function getPublicEventsPage(
  params: EventListParams,
): Promise<PublicEventsPage> {
  // Current-time filter: always render at request time.
  await connection();
  return getPublicEventsPageCore(params);
}

/**
 * Upcoming public event counts per category, for the filter chips. Mirrors the
 * default browse scope (`isPublic` + `date >= now`) so the chips sum to the
 * unfiltered total.
 */
export async function getCategoryCountsCore(
  now: Date = new Date(),
): Promise<Record<EventCategory, number>> {
  const counts = Object.fromEntries(
    EVENT_CATEGORIES.map((category) => [category.value, 0]),
  ) as Record<EventCategory, number>;

  const groups = await prisma.event.groupBy({
    by: ['category'],
    where: { isPublic: true, date: { gte: now } },
    _count: { _all: true },
  });
  for (const group of groups) counts[group.category] = group._count._all;
  return counts;
}

export async function getCategoryCounts(): Promise<
  Record<EventCategory, number>
> {
  await connection();
  return getCategoryCountsCore();
}

export type OrganizerEventStats = {
  event: Event;
  counts: RsvpCounts;
  fillRate: number | null;
};

/** Request-free core for the organizer dashboard split. */
export async function getOrganizerEventsCore(
  userId: string,
  now: Date = new Date(),
): Promise<{ upcoming: OrganizerEventStats[]; past: OrganizerEventStats[] }> {
  const empty = { upcoming: [], past: [] } as {
    upcoming: OrganizerEventStats[];
    past: OrganizerEventStats[];
  };
  if (!userId) return empty;
  const events = await prisma.event.findMany({
    where: { userId },
    orderBy: { date: 'asc' },
  });
  if (events.length === 0) return empty;

  const groups = await prisma.rSVP.groupBy({
    by: ['eventId', 'status'],
    where: { eventId: { in: events.map((e) => e.id) } },
    _count: { status: true },
  });
  const countsByEvent = new Map<string, RsvpCounts>();
  for (const g of groups) {
    const counts = countsByEvent.get(g.eventId) ?? { ...EMPTY_COUNTS };
    counts[g.status] = g._count.status;
    countsByEvent.set(g.eventId, counts);
  }

  const upcoming: OrganizerEventStats[] = [];
  const past: OrganizerEventStats[] = [];
  for (const event of events) {
    const counts = countsByEvent.get(event.id) ?? { ...EMPTY_COUNTS };
    const fillRate =
      event.maxAttendees != null && event.maxAttendees > 0
        ? counts.GOING / event.maxAttendees
        : null;
    const row = { event, counts, fillRate };
    if (event.date >= now) upcoming.push(row);
    else past.push(row);
  }
  past.reverse();
  return { upcoming, past };
}

/** Organizer's events with per-event RSVP funnels, split upcoming/past. */
export async function getOrganizerEvents(
  userId: string,
): Promise<{ upcoming: OrganizerEventStats[]; past: OrganizerEventStats[] }> {
  // Current-time split: always render at request time.
  await connection();
  return getOrganizerEventsCore(userId);
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

/**
 * Render-pass memoized variants for the React Server Component tree.
 *
 * `/events/[id]` reads the event from `generateMetadata`, the page and two
 * Suspense sections (4x) and the counts twice. React's `cache` dedupes those
 * calls within one render pass (it is request-scoped, never shared across
 * requests). Route Handlers are outside the RSC tree, so they must keep using
 * the raw functions above.
 */
export const getEventByIdCached = cache(getEventById);
export const getRsvpCountsCached = cache(getRsvpCounts);

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

/** Caller's RSVP row with promotion flag and notify preference. */
export async function getUserRsvp(
  eventId: string,
  userId: string,
): Promise<{
  status: RSVPStatus;
  promotedAt: Date | null;
  notifyOnUpdate: boolean;
} | null> {
  return prisma.rSVP.findUnique({
    where: { userId_eventId: { userId, eventId } },
    select: { status: true, promotedAt: true, notifyOnUpdate: true },
  });
}

export type UpcomingRsvp = {
  id: string;
  status: RSVPStatus;
  notifyOnUpdate: boolean;
  event: Event;
};

/** Caller's upcoming RSVPs (going/maybe/waitlisted), soonest event first. */
export async function getUpcomingRsvps(
  userId: string,
  limit = 5,
): Promise<UpcomingRsvp[]> {
  const take = Math.min(Math.max(limit, 1), 20);
  if (!userId) return [];
  return prisma.rSVP.findMany({
    where: {
      userId,
      status: { in: ['GOING', 'MAYBE', 'WAITLISTED'] },
      event: { date: { gte: new Date() } },
    },
    include: { event: true },
    orderBy: { event: { date: 'asc' } },
    take,
  });
}

/**
 * "Today" / "Tomorrow" / "In N days" label for an upcoming event date,
 * compared by calendar day in the event's own zone.
 */
export function startsInLabel(
  date: Date,
  timeZone?: string | null,
): string {
  const days = calendarDayDiffInZone(date, new Date(), timeZone);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  return `In ${days} days`;
}

/**
 * Visibility guard for data accessors that are only safe once the caller has
 * resolved the event. Throwing (rather than returning 404) makes a future
 * misuse fail loudly in development instead of leaking private data.
 */
async function assertCanView(
  event: Event,
  viewerId: string | null,
): Promise<void> {
  if (!(await canViewEvent(event, viewerId))) {
    throw new Error(`Event ${event.id} is not visible to this viewer.`);
  }
}

/** Ordered wishlist queue (oldest first). No identities: userIds are opaque. */
export async function getWishlist(
  event: Event,
  viewerId: string | null,
): Promise<{ userId: string; createdAt: Date }[]> {
  await assertCanView(event, viewerId);
  return prisma.rSVP.findMany({
    where: { eventId: event.id, status: 'WAITLISTED' },
    orderBy: { createdAt: 'asc' },
    select: { userId: true, createdAt: true },
  });
}

export type CommentRow = {
  id: string;
  userId: string;
  authorName: string | null;
  body: string;
  createdAt: Date;
};

/** Event comments, oldest first. Enforces visibility itself (see B5). */
export async function getComments(
  event: Event,
  viewerId: string | null,
  limit = 50,
): Promise<CommentRow[]> {
  await assertCanView(event, viewerId);
  const take = Math.min(Math.max(limit, 1), 100);
  return prisma.comment.findMany({
    where: { eventId: event.id },
    orderBy: { createdAt: 'asc' },
    take,
    select: {
      id: true,
      userId: true,
      authorName: true,
      body: true,
      createdAt: true,
    },
  });
}

/** Comment count for badges (0 when none). */
export async function getCommentCount(eventId: string): Promise<number> {
  return prisma.comment.count({ where: { eventId } });
}

export type AttendeeRow = {
  userId: string;
  attendeeName: string | null;
  status: RSVPStatus;
  createdAt: Date;
  checkedInAt: Date | null;
};

/**
 * Full attendee roster, oldest first. Names are stamped on RSVP write.
 * Enforces visibility itself (see B5); organizers pass their own id.
 */
export async function getAttendees(
  event: Event,
  viewerId: string | null,
): Promise<AttendeeRow[]> {
  await assertCanView(event, viewerId);
  return prisma.rSVP.findMany({
    where: { eventId: event.id },
    orderBy: { createdAt: 'asc' },
    select: {
      userId: true,
      attendeeName: true,
      status: true,
      createdAt: true,
      checkedInAt: true,
    },
  });
}

export type AttendeeCsvRow = AttendeeRow & { id: string };

/**
 * One cursor page of the attendee roster for CSV streaming. Keyed by `id`
 * (`createdAt` has no uniqueness guarantee) so concurrent writes cannot cause
 * a row to be skipped or duplicated across page boundaries.
 * Enforces visibility itself, like the other roster accessors.
 */
export async function getAttendeesPage(
  event: Event,
  viewerId: string | null,
  opts: { cursor?: string; take?: number } = {},
): Promise<AttendeeCsvRow[]> {
  await assertCanView(event, viewerId);
  const take = Math.min(Math.max(opts.take ?? 500, 1), 1000);
  return prisma.rSVP.findMany({
    where: { eventId: event.id },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take,
    ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
    select: {
      id: true,
      userId: true,
      attendeeName: true,
      status: true,
      createdAt: true,
      checkedInAt: true,
    },
  });
}

/** Active reusable invite token for an event (null when none/revoked). */
export async function getInviteToken(eventId: string): Promise<string | null> {
  const row = await prisma.event.findUnique({
    where: { id: eventId },
    select: { inviteToken: true },
  });
  return row?.inviteToken ?? null;
}

/** Resolve an event from a reusable invite token (null when unknown/revoked). */
export async function getEventByInviteToken(
  token: string,
): Promise<Event | null> {
  if (!token) return null;
  return prisma.event.findUnique({ where: { inviteToken: token } });
}

export type WishlistEntry = {
  id: string;
  status: RSVPStatus;
  createdAt: Date;
  promotedAt: Date | null;
  waitlistPosition: number | null;
  event: Event;
};

/**
 * Events the user wishlisted, each with its live queue position.
 *
 * Two queries total, regardless of how many events: the second query fetches
 * every waitlisted row for the relevant events once and positions are derived
 * from that shared ordering in memory. The previous version called
 * `getWaitlistPosition` per row (1 + N queries).
 */
export async function getUserWishlist(userId: string): Promise<WishlistEntry[]> {
  const rows = await prisma.rSVP.findMany({
    where: { userId, status: 'WAITLISTED' },
    include: { event: true },
    orderBy: { createdAt: 'asc' },
  });
  if (rows.length === 0) return [];

  const eventIds = [...new Set(rows.map((row) => row.eventId))];
  const queues = await prisma.rSVP.findMany({
    where: { eventId: { in: eventIds }, status: 'WAITLISTED' },
    select: { eventId: true, userId: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  });

  const positionByEntry = new Map<string, number>();
  const nextPosition = new Map<string, number>();
  for (const entry of queues) {
    const position = (nextPosition.get(entry.eventId) ?? 0) + 1;
    nextPosition.set(entry.eventId, position);
    positionByEntry.set(`${entry.eventId}:${entry.userId}`, position);
  }

  return rows.map((row) => ({
    id: row.id,
    status: row.status,
    createdAt: row.createdAt,
    promotedAt: row.promotedAt,
    waitlistPosition:
      positionByEntry.get(`${row.eventId}:${row.userId}`) ?? null,
    event: row.event,
  }));
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
