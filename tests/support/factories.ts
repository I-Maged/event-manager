import type {
  Event,
  EventCategory,
  NotificationType,
  RSVPStatus,
} from '@/generated/prisma';
import { prisma } from './db';

/**
 * Test-data factories.
 *
 * Every generated value carries a per-process `RUN_ID` prefix so leftovers from
 * a crashed run can be found and swept without touching other rows.
 */

export const RUN_ID = `t${Date.now().toString(36)}${Math.random()
  .toString(36)
  .slice(2, 8)}`;

let counter = 0;

/** Unique, sortable-looking id with the run prefix. */
export function uniqueId(label = 'id'): string {
  counter += 1;
  return `${RUN_ID}-${label}-${counter}`;
}

export const DAY_MS = 24 * 60 * 60 * 1000;

export function futureDate(daysFromNow = 7, base: number = Date.now()): Date {
  return new Date(base + daysFromNow * DAY_MS);
}

export function pastDate(daysAgo = 7, base: number = Date.now()): Date {
  return new Date(base - daysAgo * DAY_MS);
}

type EventInput = {
  id?: string;
  title: string;
  description: string;
  date: Date;
  timeZone?: string | null;
  location: string;
  maxAttendees?: number | null;
  isPublic?: boolean;
  category?: EventCategory;
  userId: string;
  organizerName?: string | null;
  inviteToken?: string | null;
  createdAt?: Date;
};

export async function makeEvent(
  overrides: Partial<EventInput> = {},
): Promise<Event> {
  const suffix = uniqueId('event');
  return prisma.event.create({
    data: {
      title: `Test event ${suffix}`,
      description: 'Factory-created test event.',
      date: futureDate(),
      timeZone: 'Europe/Berlin',
      location: 'Test venue',
      maxAttendees: null,
      isPublic: true,
      category: 'OTHER',
      userId: uniqueId('organizer'),
      organizerName: 'Test Organizer',
      ...overrides,
    },
  });
}

type RsvpInput = {
  eventId: string;
  userId: string;
  status?: RSVPStatus;
  createdAt?: Date;
  promotedAt?: Date | null;
  attendeeName?: string | null;
  checkedInAt?: Date | null;
  checkedInBy?: string | null;
  notifyOnUpdate?: boolean;
};

export async function makeRsvp(
  overrides: Partial<RsvpInput> & Pick<RsvpInput, 'eventId'>,
): Promise<{ id: string }> {
  return prisma.rSVP.create({
    data: {
      userId: uniqueId('user'),
      status: 'GOING',
      ...overrides,
    },
    select: { id: true },
  });
}

type CommentInput = {
  eventId: string;
  userId?: string;
  authorName?: string | null;
  body?: string;
  createdAt?: Date;
};

export async function makeComment(
  overrides: Partial<CommentInput> & Pick<CommentInput, 'eventId'>,
): Promise<{ id: string }> {
  return prisma.comment.create({
    data: {
      userId: uniqueId('commenter'),
      authorName: 'Test Commenter',
      body: 'Factory-created comment.',
      ...overrides,
    },
    select: { id: true },
  });
}

type NotificationInput = {
  userId: string;
  eventId?: string | null;
  type?: NotificationType;
  title?: string;
  body?: string | null;
  readAt?: Date | null;
  createdAt?: Date;
};

export async function makeNotification(
  overrides: Partial<NotificationInput> & Pick<NotificationInput, 'userId'>,
): Promise<{ id: string }> {
  return prisma.notification.create({
    data: {
      eventId: null,
      type: 'PROMOTION',
      title: 'Factory notification',
      body: null,
      ...overrides,
    },
    select: { id: true },
  });
}

type RateLimitInput = {
  key: string;
  count?: number;
  windowStart?: Date;
};

export async function makeRateLimit(
  overrides: Partial<RateLimitInput> & Pick<RateLimitInput, 'key'>,
): Promise<void> {
  await prisma.rateLimit.create({
    data: {
      count: 0,
      windowStart: new Date(),
      ...overrides,
    },
  });
}
