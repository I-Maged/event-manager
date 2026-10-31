import { beforeEach, describe, expect, it } from 'vitest';
import { baseUrl } from './helpers/server';
import { request } from './helpers/client';
import { clearSession, adoptRosterUser } from './helpers/auth';
import { checkInAttendeeCore } from '@/lib/check-in';
import { prisma, resetDomainTables } from '../support/db';
import { futureDate, makeEvent, makeRsvp, uniqueId } from '../support/factories';

beforeEach(async () => {
  clearSession();
  await resetDomainTables();
});

function csvRows(body: string): string[] {
  return body.split('\n').filter((line) => line.length > 0);
}

async function organizerEvent(options: {
  maxAttendees?: number | null;
  isPublic?: boolean;
} = {}) {
  const organizer = adoptRosterUser('organizer');
  const event = await makeEvent({
    userId: organizer.userId,
    maxAttendees: options.maxAttendees ?? null,
    isPublic: options.isPublic ?? true,
    date: futureDate(30),
  });
  return { organizer, event };
}

describe('Attendee CSV route (4.2)', () => {
  it('unauthenticated request returns 401', async () => {
    const event = await makeEvent({ isPublic: true });
    const res = await request(`${baseUrl}/api/events/${event.id}/attendees`);
    expect(res.status).toBe(401);
  });

  it('non-organizer returns 404', async () => {
    const event = await makeEvent({ userId: uniqueId('owner') });
    adoptRosterUser('other');
    const res = await request(`${baseUrl}/api/events/${event.id}/attendees`);
    expect(res.status).toBe(404);
  });

  it('unknown event returns 404 when signed in', async () => {
    adoptRosterUser('organizer');
    const res = await request(
      `${baseUrl}/api/events/does-not-exist/attendees`,
    );
    expect(res.status).toBe(404);
  });

  it('organizer gets 200 with CSV header and correct columns', async () => {
    const { organizer, event } = await organizerEvent({ maxAttendees: 3 });
    const going = uniqueId('a1');
    const waitlisted = uniqueId('a2');
    await makeRsvp({
      eventId: event.id,
      userId: going,
      status: 'GOING',
      attendeeName: 'Ada, Lovelace',
    });
    await makeRsvp({
      eventId: event.id,
      userId: waitlisted,
      status: 'WAITLISTED',
      attendeeName: 'Bob "Quotes" Smith',
    });
    await checkInAttendeeCore(event.id, going, organizer.userId);

    const res = await request(`${baseUrl}/api/events/${event.id}/attendees`);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/csv');
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');

    const rows = csvRows(await res.text());
    expect(rows[0]).toBe('status,name,joined_at,checked_in');

    const adaRow = rows.find((row) => row.includes('Ada'));
    expect(adaRow).toBeDefined();
    expect(adaRow!).toContain('GOING');
    expect(adaRow!).toContain('"Ada, Lovelace"');
    // joined_at and checked_in are ISO timestamps; the checked-in row has both.
    expect(adaRow!).toMatch(/"\d{4}-\d{2}-\d{2}T[^"]*Z"$/);

    const bobRow = rows.find((row) => row.includes('Bob'));
    expect(bobRow).toBeDefined();
    expect(bobRow!).toContain('WAITLISTED');
    expect(bobRow!).toContain('"Bob ""Quotes"" Smith"');
    expect(bobRow!.endsWith(',""')).toBe(true);
  });

  it('formula-injection prefix names get a leading apostrophe', async () => {
    const { event } = await organizerEvent();
    for (const attendeeName of ['=1+1', '+SUM(A1)', '-DATA', '@evil']) {
      await makeRsvp({
        eventId: event.id,
        userId: uniqueId('user'),
        status: 'GOING',
        attendeeName,
      });
    }

    const res = await request(`${baseUrl}/api/events/${event.id}/attendees`);
    expect(res.status).toBe(200);
    const rows = csvRows(await res.text());
    expect(rows).toHaveLength(5);
    for (const row of rows.slice(1)) {
      const nameCell = row.split(',')[1];
      expect(nameCell).toMatch(/^"/);
      const inner = nameCell.slice(1, -1).replace(/""/g, '"');
      expect(inner).not.toMatch(/^[=+\-@]/);
      expect(inner).toMatch(/^'[=+\-@]/);
    }
  });

  it('1,200 attendees stream across 500-row pages without duplicates or skips', async () => {
    const { event } = await organizerEvent({ maxAttendees: null });
    const COUNT = 1200;
    await prisma.rSVP.createMany({
      data: Array.from({ length: COUNT }, (_, index) => ({
        eventId: event.id,
        userId: uniqueId('attendee'),
        status: 'GOING' as const,
        attendeeName: `Attendee ${String(index).padStart(4, '0')}`,
      })),
    });

    const res = await request(`${baseUrl}/api/events/${event.id}/attendees`);
    expect(res.status).toBe(200);
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    const chunks: string[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(decoder.decode(value, { stream: true }));
    }
    const body = chunks.join('') + decoder.decode();
    const rows = csvRows(body);
    expect(rows).toHaveLength(COUNT + 1);

    // Streaming: the body arrives in multiple chunks rather than one buffered blob.
    expect(chunks.length).toBeGreaterThanOrEqual(3);
    expect(chunks[0].length).toBeLessThan(body.length / 3);

    const dataRows = rows.slice(1);
    expect(new Set(dataRows).size).toBe(COUNT);
    expect(dataRows.length).toBe(COUNT);
  });

  /**
   * Mid-export database failures are asserted at the stream layer
   * (`tests/unit/attendee-csv.test.ts`): by the time a page fails, the response
   * status `200` and the CSV headers are already on the wire, so the only
   * honest contract is an errored body plus one server log line. This layer
   * keeps the happy path, headers, and client-abort behaviour.
   */
  it('a client abort does not take down the server', async () => {
    const { event } = await organizerEvent();
    await makeRsvp({
      eventId: event.id,
      userId: uniqueId('attendee'),
      status: 'GOING',
      attendeeName: 'Aborted Reader',
    });

    const controller = new AbortController();
    const res = await request(`${baseUrl}/api/events/${event.id}/attendees`, {
      signal: controller.signal,
    });
    expect(res.status).toBe(200);
    controller.abort();
    await res.text().catch(() => undefined);

    // The next request on the same server still succeeds.
    const followUp = await request(`${baseUrl}/api/events/${event.id}/attendees`);
    expect(followUp.status).toBe(200);
    expect(await followUp.text()).toContain('Aborted Reader');
  });

  it('Cache-Control is private, no-store', async () => {
    const { event } = await organizerEvent();
    const res = await request(`${baseUrl}/api/events/${event.id}/attendees`);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
  });
});
