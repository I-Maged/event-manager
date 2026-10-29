import { config as loadEnv } from 'dotenv';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { PrismaClient } from '../../../src/generated/prisma';
import { PrismaNeon } from '@prisma/adapter-neon';
import { E2E_ENABLED, E2E_ROSTER_PATH } from './env';

const testEnvPath = resolve(process.cwd(), '.env.test');
if (existsSync(testEnvPath)) {
  loadEnv({ path: testEnvPath, quiet: true });
}

const E2E_DB_AVAILABLE = E2E_ENABLED;

let cachedClient: PrismaClient | null = null;

function ensureClient(): PrismaClient {
  if (cachedClient) return cachedClient;
  if (!E2E_DB_AVAILABLE) {
    throw new Error('DB is not available: E2E is not enabled.');
  }
  const { assertTestDatabaseSafety } = require('../../support/env');
  assertTestDatabaseSafety();
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is not set.');
  const adapter = new PrismaNeon({ connectionString });
  cachedClient = new PrismaClient({ adapter });
  return cachedClient;
}

const proxy: any = new Proxy(
  {},
  {
    get(_target, prop) {
      return (ensureClient() as any)[prop];
    },
  },
);

export const prisma = proxy;

const DOMAIN_TABLES = [
  '"Notification"',
  '"Comment"',
  '"RSVP"',
  '"Event"',
  '"RateLimit"',
];

export async function resetDomainTables(): Promise<void> {
  const client = ensureClient();
  await client.$executeRawUnsafe(
    `TRUNCATE TABLE ${DOMAIN_TABLES.join(', ')} RESTART IDENTITY CASCADE`,
  );
}

export async function deleteEvent(eventId: string): Promise<void> {
  const client = ensureClient();
  await client.event.deleteMany({ where: { id: eventId } });
}

export async function closeDb(): Promise<void> {
  if (cachedClient) await cachedClient.$disconnect();
}

export async function clearRateLimits(userId: string): Promise<void> {
  const client = ensureClient();
  const scopes = ['rsvp', 'comment', 'eventCreate', 'eventEdit'];
  for (const scope of scopes) {
    await client.rateLimit.deleteMany({
      where: { key: `${scope}:${userId}` },
    });
  }
}

import { readRoster } from './fixtures';

export type SeedEventOptions = {
  title?: string;
  description?: string;
  date?: Date;
  timeZone?: string | null;
  location?: string;
  maxAttendees?: number | null;
  isPublic?: boolean;
  category?: any;
  userId?: string;
  organizerName?: string | null;
};

export async function seedEvent(
  overrides: SeedEventOptions = {},
): Promise<any> {
  const roster = readRoster();
  return prisma.event.create({
    data: {
      title: overrides.title ?? 'Seeded event',
      description: overrides.description ?? 'Factory-created test event.',
      date:
        overrides.date ??
        new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      timeZone:
        overrides.timeZone === undefined ? 'Europe/Berlin' : overrides.timeZone,
      location: overrides.location ?? 'Test venue',
      maxAttendees:
        overrides.maxAttendees === undefined
          ? null
          : overrides.maxAttendees,
      isPublic: overrides.isPublic ?? true,
      category: overrides.category ?? 'OTHER',
      userId: overrides.userId ?? roster.organizer.userId,
      organizerName: overrides.organizerName ?? 'Org',
    },
  });
}

export async function seedRsvp(
  eventId: string,
  userId: string,
  overrides: Record<string, unknown> = {},
): Promise<any> {
  return prisma.rSVP.create({
    data: {
      eventId,
      userId,
      status: 'GOING',
      attendeeName: 'Seeded attendee',
      ...overrides,
    },
  });
}

export async function seedComment(
  eventId: string,
  userId: string,
  overrides: Record<string, unknown> = {},
): Promise<any> {
  return prisma.comment.create({
    data: {
      eventId,
      userId,
      authorName: 'Seeded commenter',
      body: 'Seeded comment',
      ...overrides,
    },
  });
}

export async function seedNotification(
  userId: string,
  overrides: Record<string, unknown> = {},
): Promise<any> {
  return prisma.notification.create({
    data: {
      userId,
      type: 'PROMOTION',
      title: 'Seeded notification',
      body: 'hello',
      eventId: null,
      ...overrides,
    },
  });
}

export async function seedRateLimit(
  key: string,
  count = 0,
  windowStart: Date = new Date(),
): Promise<void> {
  await prisma.rateLimit.create({
    data: { key, count, windowStart },
  });
}

export { E2E_ROSTER_PATH };