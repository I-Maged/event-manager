import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { prisma, resetDomainTables } from '../support/db';
import { makeComment, makeEvent, makeNotification, makeRsvp, uniqueId } from '../support/factories';

describe('Migrations', () => {
  beforeEach(async () => {
    await resetDomainTables();
  });

  it('prisma migrate deploy succeeded on this branch (setup applied migrations)', async () => {
    // The db setup project runs `prisma migrate deploy` before tests. If we can
    // query the schema tables, migrations applied cleanly.
    const count = await prisma.event.count();
    expect(typeof count).toBe('number');
  });

  it('no script or documented command uses prisma db push', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as {
      scripts?: Record<string, string>;
    };
    for (const [name, command] of Object.entries(pkg.scripts ?? {})) {
      expect(command, `package.json script "${name}"`).not.toMatch(/\bdb push\b/);
    }

    const files = [
      'TESTING.md',
      'testing_plan.md',
      'scripts/test-db.ts',
      'scripts/preflight.ts',
      'scripts/backfill-time-zone.ts',
      'scripts/rate-limit-cleanup.ts',
      'scripts/rsvp-concurrency.ts',
      'scripts/rate-limit-check.ts',
      'scripts/search-check.ts',
      'scripts/timezone-check.ts',
    ];
    for (const file of files) {
      let content = '';
      try {
        content = readFileSync(file, 'utf8');
      } catch {
        continue;
      }
      // A prohibition ("never use prisma db push") is allowed; an actual
      // command reference is not.
      for (const line of content.split(/\r?\n/)) {
        if (!/\bdb push\b/.test(line)) continue;
        expect(line, file).toMatch(/never|\bnot\b|\bno\b|forbid|avoid|prohibit/i);
      }
    }
  });
});

describe('CHECK constraints', () => {
  beforeEach(async () => {
    await resetDomainTables();
  });

  it('Event_maxAttendees_positive rejects zero', async () => {
    const event = await makeEvent({ maxAttendees: 5 });
    await expect(
      prisma.event.update({
        where: { id: event.id },
        data: { maxAttendees: 0 },
      }),
    ).rejects.toThrow();
  });

  it('Event_maxAttendees_positive rejects negative values', async () => {
    const event = await makeEvent({ maxAttendees: 5 });
    await expect(
      prisma.event.update({
        where: { id: event.id },
        data: { maxAttendees: -1 },
      }),
    ).rejects.toThrow();
  });

  it('Comment_body_length rejects bodies over 1000 characters', async () => {
    const event = await makeEvent();
    await expect(
      prisma.comment.create({
        data: {
          eventId: event.id,
          userId: uniqueId('user'),
          body: 'x'.repeat(1001),
        },
      }),
    ).rejects.toThrow();
  });
});

describe('Uniqueness constraints', () => {
  beforeEach(async () => {
    await resetDomainTables();
  });

  it('(userId, eventId) uniqueness is enforced on RSVP', async () => {
    const event = await makeEvent({ maxAttendees: null });
    const userId = uniqueId('user');
    await makeRsvp({ eventId: event.id, userId, status: 'GOING' });
    await expect(
      makeRsvp({ eventId: event.id, userId, status: 'MAYBE' }),
    ).rejects.toThrow();
  });

  it('inviteToken uniqueness is enforced', async () => {
    const token = uniqueId('token');
    await makeEvent({ isPublic: false, inviteToken: token });
    await expect(
      makeEvent({ isPublic: false, inviteToken: token }),
    ).rejects.toThrow();
  });
});

describe('Cascades', () => {
  beforeEach(async () => {
    await resetDomainTables();
  });

  it('deleting an event cascades to RSVPs, comments, and event-bound notifications', async () => {
    const event = await makeEvent({ maxAttendees: null });
    const user = uniqueId('user');
    await makeRsvp({ eventId: event.id, userId: user, status: 'GOING' });
    await makeComment({ eventId: event.id, userId: user });
    await makeNotification({ userId: user, eventId: event.id, type: 'EVENT_UPDATED' });

    await prisma.event.delete({ where: { id: event.id } });

    expect(await prisma.rSVP.count({ where: { eventId: event.id } })).toBe(0);
    expect(await prisma.comment.count({ where: { eventId: event.id } })).toBe(0);
    expect(
      await prisma.notification.count({ where: { eventId: event.id } }),
    ).toBe(0);
  });

  it('cancellation notifications with eventId: null survive event deletion', async () => {
    const event = await makeEvent({ maxAttendees: null });
    const user = uniqueId('user');
    await makeNotification({
      userId: user,
      eventId: null,
      type: 'EVENT_CANCELLED',
      title: 'Event cancelled: X',
    });

    await prisma.event.delete({ where: { id: event.id } });

    const surviving = await prisma.notification.findMany({
      where: { userId: user, eventId: null, type: 'EVENT_CANCELLED' },
    });
    expect(surviving).toHaveLength(1);
  });
});

describe('Hot-path indexes', () => {
  beforeEach(async () => {
    await resetDomainTables();
  });

  it('expected indexes exist on Event and RSVP', async () => {
    const indexes = await prisma.$queryRawUnsafe<{ indexname: string }[]>(
      `SELECT indexname::text AS indexname FROM pg_indexes WHERE tablename = 'Event'`,
    );
    const eventIndexNames = indexes.map((i) => i.indexname);
    expect(eventIndexNames).toEqual(expect.arrayContaining([
      expect.stringContaining('Event_userId_date_idx'),
      expect.stringContaining('Event_isPublic_date_idx'),
      expect.stringContaining('Event_category_date_idx'),
    ]));

    const rsvpIndexes = await prisma.$queryRawUnsafe<{ indexname: string }[]>(
      `SELECT indexname::text AS indexname FROM pg_indexes WHERE tablename = 'RSVP'`,
    );
    const rsvpIndexNames = rsvpIndexes.map((i) => i.indexname);
    expect(rsvpIndexNames).toEqual(expect.arrayContaining([
      expect.stringContaining('RSVP_userId_idx'),
      expect.stringContaining('RSVP_eventId_idx'),
      expect.stringContaining('RSVP_eventId_status_createdAt_idx'),
    ]));
  });
});
