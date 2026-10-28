import { beforeEach, describe, expect, it } from 'vitest';
import { baseUrl } from './helpers/server';
import { request } from './helpers/client';
import { clearSession, adoptRosterUser } from './helpers/auth';
import { resetDomainTables } from '../support/db';
import { makeEvent, makeRsvp, uniqueId } from '../support/factories';

beforeEach(async () => {
  clearSession();
  await resetDomainTables();
});

function icsLine(ics: string, prefix: string): string | null {
  return ics.split('\r\n').find((line) => line.startsWith(prefix)) ?? null;
}

function icsValue(ics: string, prefix: string): string | null {
  const line = icsLine(ics, prefix);
  return line ? line.slice(prefix.length) : null;
}

/** Parse `YYYYMMDDTHHMMSSZ` into epoch milliseconds. */
function icsDateToMs(value: string): number {
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(value);
  if (!match) throw new Error(`Not an ICS UTC date: ${value}`);
  const [, year, month, day, hour, minute, second] = match;
  return Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
  );
}

describe('Calendar route (4.1)', () => {
  it('public event returns 200 with text/calendar and no-store', async () => {
    const event = await makeEvent({ isPublic: true });
    const res = await request(`${baseUrl}/api/events/${event.id}/calendar`);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/calendar');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(res.headers.get('Content-Disposition')).toContain(
      `filename="event-${event.id}.ics"`,
    );
  });

  it('private event returns 200 for the organizer', async () => {
    const organizer = adoptRosterUser('organizer');
    const event = await makeEvent({
      isPublic: false,
      userId: organizer.userId,
    });
    const res = await request(`${baseUrl}/api/events/${event.id}/calendar`);
    expect(res.status).toBe(200);
  });

  it('private event returns 200 for an RSVP holder', async () => {
    const holder = adoptRosterUser('holder');
    const event = await makeEvent({ isPublic: false });
    await makeRsvp({
      eventId: event.id,
      userId: holder.userId,
      status: 'GOING',
    });
    const res = await request(`${baseUrl}/api/events/${event.id}/calendar`);
    expect(res.status).toBe(200);
  });

  it('private event returns 404 for an outsider', async () => {
    adoptRosterUser('outsider');
    const event = await makeEvent({ isPublic: false });
    const res = await request(`${baseUrl}/api/events/${event.id}/calendar`);
    expect(res.status).toBe(404);
  });

  it('unknown event returns 404', async () => {
    const res = await request(
      `${baseUrl}/api/events/does-not-exist/calendar`,
    );
    expect(res.status).toBe(404);
  });

  it('ICS contains required properties', async () => {
    const event = await makeEvent({
      title: 'Summer Party',
      location: 'The Roof',
    });
    const res = await request(`${baseUrl}/api/events/${event.id}/calendar`);
    expect(res.status).toBe(200);
    const ics = await res.text();
    for (const property of [
      'BEGIN:VCALENDAR',
      'END:VCALENDAR',
      'UID:',
      'DTSTAMP:',
      'DTSTART:',
      'DTEND:',
      'SUMMARY:',
      'LOCATION:',
    ]) {
      expect(icsLine(ics, property), property).not.toBeNull();
    }
    expect(ics).toContain('BEGIN:VEVENT');
    expect(ics).toContain('END:VEVENT');
  });

  it('DTEND is exactly two hours after DTSTART', async () => {
    const event = await makeEvent({
      date: new Date('2027-10-20T18:00:00Z'),
    });
    const res = await request(`${baseUrl}/api/events/${event.id}/calendar`);
    expect(res.status).toBe(200);
    const ics = await res.text();
    const start = icsValue(ics, 'DTSTART:');
    const end = icsValue(ics, 'DTEND:');
    expect(start).not.toBeNull();
    expect(end).not.toBeNull();
    expect(icsDateToMs(end!) - icsDateToMs(start!)).toBe(2 * 60 * 60 * 1000);
  });

  it('escapes special characters in title, location, description', async () => {
    const event = await makeEvent({
      title: 'A; B, C\\D',
      location: 'Room; 101',
      description: 'Line one\nLine two',
    });
    const res = await request(`${baseUrl}/api/events/${event.id}/calendar`);
    expect(res.status).toBe(200);
    const ics = await res.text();
    expect(ics).toContain('SUMMARY:A\\; B\\, C\\\\D');
    expect(ics).toContain('LOCATION:Room\\; 101');
    expect(ics).toContain('DESCRIPTION:Line one\\nLine two');
  });

  it('injected newlines cannot create new ICS properties', async () => {
    const event = await makeEvent({
      title: 'X\r\nBEGIN:VALARM',
      location: 'Y\nEND:VCALENDAR',
    });
    const res = await request(`${baseUrl}/api/events/${event.id}/calendar`);
    expect(res.status).toBe(200);
    const ics = await res.text();
    expect(ics).not.toMatch(/\r\nBEGIN:VALARM/);
    expect(ics.match(/\r\nEND:VCALENDAR/g)).toHaveLength(1);
  });

  it('valid origin produces a URL property', async () => {
    const event = await makeEvent();
    const res = await request(`${baseUrl}/api/events/${event.id}/calendar`);
    expect(res.status).toBe(200);
    const ics = await res.text();
    expect(ics).toContain(`URL:${baseUrl}/events/${event.id}`);
  });

  it('a request with an unusable origin still returns a valid calendar', async () => {
    // An HTTP request always carries an origin, so this asserts the fallback
    // path does not break ICS generation. The origin-less case is covered by
    // the unit tests for `buildIcs`.
    const event = await makeEvent();
    const res = await request(`${baseUrl}/api/events/${event.id}/calendar`, {
      headers: { 'x-test-origin': uniqueId('origin') },
    });
    expect(res.status).toBe(200);
    const ics = await res.text();
    expect(ics).toContain('BEGIN:VEVENT');
  });
});
