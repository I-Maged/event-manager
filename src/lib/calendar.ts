import type { Event } from '@/generated/prisma';

export type CalendarEventInput = Pick<
  Event,
  'id' | 'title' | 'description' | 'location' | 'date'
>;

/** Default event length (no end field exists on Event — don't add one v1). */
export const CALENDAR_EVENT_DURATION_MS = 2 * 60 * 60 * 1000;

export function getCalendarEnd(date: Date): Date {
  return new Date(date.getTime() + CALENDAR_EVENT_DURATION_MS);
}

/** Escape text for ICS SUMMARY/LOCATION/DESCRIPTION values. */
export function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

/** Format a Date as UTC `YYYYMMDDTHHMMSSZ` for ICS / Google Calendar. */
export function formatIcsDate(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function hostFromOrigin(origin?: string | null): string {
  if (!origin) return 'eventplanner';
  try {
    return new URL(origin).host || 'eventplanner';
  } catch {
    return 'eventplanner';
  }
}

function eventUrl(eventId: string, origin?: string | null): string | null {
  if (!origin) return null;
  try {
    return new URL(`/events/${eventId}`, origin).toString();
  } catch {
    return null;
  }
}

/** Build a minimal VCALENDAR document with a single VEVENT (CRLF-joined). */
export function buildIcs(
  event: CalendarEventInput,
  opts?: { origin?: string | null; now?: Date },
): string {
  const start = event.date instanceof Date ? event.date : new Date(event.date);
  const end = getCalendarEnd(start);
  const stamp = opts?.now ?? new Date();
  const host = hostFromOrigin(opts?.origin);
  const url = eventUrl(event.id, opts?.origin);

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//EventPlanner//EN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${event.id}@${host}`,
    `DTSTAMP:${formatIcsDate(stamp)}`,
    `DTSTART:${formatIcsDate(start)}`,
    `DTEND:${formatIcsDate(end)}`,
    `SUMMARY:${escapeIcsText(event.title)}`,
    `DESCRIPTION:${escapeIcsText(event.description)}`,
    `LOCATION:${escapeIcsText(event.location)}`,
    ...(url ? [`URL:${url}`] : []),
    'STATUS:CONFIRMED',
    'TRANSP:OPAQUE',
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.join('\r\n');
}

/** Google Calendar template link for the same 2h window as the ICS. */
export function googleCalendarUrl(
  event: CalendarEventInput,
  opts?: { origin?: string | null },
): string {
  const start = event.date instanceof Date ? event.date : new Date(event.date);
  const end = getCalendarEnd(start);
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: event.title,
    dates: `${formatIcsDate(start)}/${formatIcsDate(end)}`,
    details: event.description,
    location: event.location,
  });
  const url = eventUrl(event.id, opts?.origin);
  if (url) params.set('sprop', `website:${url}`);
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}
