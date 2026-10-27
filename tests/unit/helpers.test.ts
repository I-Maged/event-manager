import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Event } from '@/generated/prisma';
import { isFrameworkControlFlow } from '@/lib/action-errors';
import {
  buildIcs,
  escapeIcsText,
  formatIcsDate,
  getCalendarEnd,
  googleCalendarUrl,
} from '@/lib/calendar';
import { categoryLabel, EVENT_CATEGORIES, isEventCategory } from '@/lib/categories';
import { MAX_COMMENT_LENGTH } from '@/lib/comments';
import {
  organizerAccentClass,
  resolveOrganizerName,
  spotsLeft,
  startsInLabel,
} from '@/lib/events';
import { newInviteToken } from '@/lib/invite';
import { RATE_LIMIT_MESSAGE, RATE_LIMITS } from '@/lib/rate-limit';

const event = {
  id: 'evt_1',
  title: 'Jazz & Blues, Live',
  description: 'Line one\nLine two; with, punctuation',
  date: new Date('2026-10-20T18:00:00Z'),
  location: 'Berlin; Hall',
} as unknown as Event;

describe('resolveOrganizerName', () => {
  it('prefers a trimmed name', () => {
    expect(resolveOrganizerName({ name: '  Ada  ', email: 'ada@x.dev' })).toBe(
      'Ada',
    );
  });

  it('falls back to the email local part', () => {
    expect(resolveOrganizerName({ name: '   ', email: 'ada@x.dev' })).toBe('ada');
  });

  it('returns null when neither is usable', () => {
    expect(resolveOrganizerName(null)).toBeNull();
    expect(resolveOrganizerName({ name: '', email: '' })).toBeNull();
    expect(resolveOrganizerName({ name: '  ', email: '  ' })).toBeNull();
  });

  it('caps the result at 120 characters', () => {
    expect(resolveOrganizerName({ name: 'x'.repeat(200) })).toHaveLength(120);
    expect(
      resolveOrganizerName({ email: `${'y'.repeat(200)}@x.dev` }),
    ).toHaveLength(120);
  });
});

describe('organizerAccentClass', () => {
  it('is deterministic and always a known accent', () => {
    const known = new Set(
      Array.from({ length: 6 }, (_, i) => `organizer-accent-${i}`),
    );
    for (const id of ['user-1', 'user-2', '', 'üñî-code']) {
      const first = organizerAccentClass(id);
      expect(first).toBe(organizerAccentClass(id));
      expect(known.has(first)).toBe(true);
    }
  });
});

describe('spotsLeft', () => {
  it('is null for uncapped events', () => {
    expect(spotsLeft({ maxAttendees: null } as unknown as Event, 3)).toBeNull();
  });

  it('reports remaining seats and clamps at zero', () => {
    expect(spotsLeft({ maxAttendees: 10 } as unknown as Event, 3)).toBe(7);
    expect(spotsLeft({ maxAttendees: 2 } as unknown as Event, 5)).toBe(0);
  });
});

describe('startsInLabel', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('labels today, tomorrow, and later days in the event zone', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-20T09:00:00Z'));
    expect(startsInLabel(new Date('2026-10-20T18:00:00Z'), 'Europe/Berlin')).toBe(
      'Today',
    );
    expect(startsInLabel(new Date('2026-10-21T18:00:00Z'), 'Europe/Berlin')).toBe(
      'Tomorrow',
    );
    expect(startsInLabel(new Date('2026-10-23T18:00:00Z'), 'Europe/Berlin')).toBe(
      'In 3 days',
    );
  });

  it('treats past dates as today (already started)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-20T09:00:00Z'));
    expect(startsInLabel(new Date('2026-10-19T18:00:00Z'), 'UTC')).toBe('Today');
  });
});

describe('categories', () => {
  it('covers every enum value with a label', () => {
    const values = EVENT_CATEGORIES.map((category) => category.value);
    expect(new Set(values).size).toBe(values.length);
    expect(values).toContain('OTHER');
    for (const { value, label } of EVENT_CATEGORIES) {
      expect(label.length).toBeGreaterThan(0);
      expect(categoryLabel(value)).toBe(label);
    }
  });

  it('narrows arbitrary values', () => {
    expect(isEventCategory('MUSIC')).toBe(true);
    expect(isEventCategory('music')).toBe(false);
    expect(isEventCategory('NOPE')).toBe(false);
    expect(isEventCategory(null)).toBe(false);
    expect(categoryLabel('NOPE' as never)).toBe('Other');
  });
});

describe('invite tokens', () => {
  it('returns a 32-character URL-safe token, unique per call', () => {
    const first = newInviteToken();
    const second = newInviteToken();
    expect(first).toMatch(/^[0-9a-f]{32}$/);
    expect(second).toMatch(/^[0-9a-f]{32}$/);
    expect(first).not.toBe(second);
  });
});

describe('shared limits', () => {
  it('matches the DB comment CHECK constraint', () => {
    expect(MAX_COMMENT_LENGTH).toBe(1000);
  });

  it('declares a positive budget for every rate-limit scope', () => {
    expect(RATE_LIMIT_MESSAGE.length).toBeGreaterThan(0);
    for (const budget of Object.values(RATE_LIMITS)) {
      expect(budget.limit).toBeGreaterThan(0);
      expect(budget.windowMs).toBeGreaterThan(0);
    }
    expect(RATE_LIMITS.comment.limit).toBeLessThan(RATE_LIMITS.rsvp.limit);
    expect(RATE_LIMITS.eventCreate).toEqual({
      limit: 10,
      windowMs: 60 * 60_000,
    });
    expect(RATE_LIMITS.commentDelete).toEqual({ limit: 30, windowMs: 60_000 });
    expect(RATE_LIMITS.checkIn).toEqual({ limit: 60, windowMs: 60_000 });
  });
});

describe('framework control flow', () => {
  it('recognizes redirects and not-found fallbacks', () => {
    expect(
      isFrameworkControlFlow({ digest: 'NEXT_REDIRECT;replace;/auth/sign-in;307;' }),
    ).toBe(true);
    expect(isFrameworkControlFlow({ digest: 'NEXT_HTTP_ERROR_FALLBACK;404' })).toBe(
      true,
    );
  });

  it('rejects unrelated, missing, and non-string digests', () => {
    expect(isFrameworkControlFlow(new Error('boom'))).toBe(false);
    expect(isFrameworkControlFlow({ digest: 'SOMETHING_ELSE' })).toBe(false);
    expect(isFrameworkControlFlow({ digest: 42 })).toBe(false);
    expect(isFrameworkControlFlow(null)).toBe(false);
  });
});

describe('calendar output', () => {
  it('escapes ICS text', () => {
    expect(escapeIcsText('a\\b;c,d')).toBe('a\\\\b\\;c\\,d');
    expect(escapeIcsText('one\r\ntwo\rthree\nfour')).toBe(
      'one\\ntwo\\nthree\\nfour',
    );
  });

  it('formats UTC ICS timestamps and a two-hour window', () => {
    expect(formatIcsDate(new Date('2026-10-20T18:00:05.123Z'))).toBe(
      '20261020T180005Z',
    );
    expect(
      getCalendarEnd(new Date('2026-10-20T18:00:00Z')).toISOString(),
    ).toBe('2026-10-20T20:00:00.000Z');
  });

  it('builds a CRLF VCALENDAR with escaped fields and a host UID', () => {
    const ics = buildIcs(event, {
      origin: 'https://events.example.com',
      now: new Date('2026-10-01T00:00:00Z'),
    });

    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics.endsWith('END:VCALENDAR')).toBe(true);
    expect(ics).toContain('\r\n');
    expect(ics).not.toMatch(/[^\r]\n/);
    expect(ics).toContain('UID:evt_1@events.example.com');
    expect(ics).toContain('DTSTAMP:20261001T000000Z');
    expect(ics).toContain('DTSTART:20261020T180000Z');
    expect(ics).toContain('DTEND:20261020T200000Z');
    expect(ics).toContain('SUMMARY:Jazz & Blues\\, Live');
    expect(ics).toContain('LOCATION:Berlin\\; Hall');
    expect(ics).toContain('DESCRIPTION:Line one\\nLine two\\; with\\, punctuation');
    expect(ics).toContain('URL:https://events.example.com/events/evt_1');
    expect(ics).toContain('STATUS:CONFIRMED');
  });

  it('omits URL and uses the fallback host without an origin', () => {
    const ics = buildIcs(event, { now: new Date('2026-10-01T00:00:00Z') });
    expect(ics).toContain('UID:evt_1@eventplanner');
    expect(ics).not.toContain('URL:');
  });

  it('cannot be injected through a title or location', () => {
    const injected = buildIcs(
      {
        ...event,
        title: 'X\r\nBEGIN:VALARM',
        location: 'Y\nEND:VCALENDAR',
      },
      { now: new Date('2026-10-01T00:00:00Z') },
    );
    // Real line starts are unaffected: injected newlines became literal \n text,
    // so no extra ICS property was created.
    expect(injected).not.toMatch(/\r\nBEGIN:VALARM/);
    expect(injected).not.toMatch(/\r\nEND:VCALENDAR.*\r\n/);
    expect(injected.match(/\r\nEND:VCALENDAR/g)).toHaveLength(1);
  });

  it('builds a Google Calendar template link', () => {
    const url = new URL(
      googleCalendarUrl(event, { origin: 'https://events.example.com' }),
    );
    expect(url.origin).toBe('https://calendar.google.com');
    expect(url.searchParams.get('action')).toBe('TEMPLATE');
    expect(url.searchParams.get('text')).toBe(event.title);
    expect(url.searchParams.get('dates')).toBe(
      '20261020T180000Z/20261020T200000Z',
    );
    expect(url.searchParams.get('details')).toBe(event.description);
    expect(url.searchParams.get('location')).toBe(event.location);
    expect(url.searchParams.get('sprop')).toBe(
      'website:https://events.example.com/events/evt_1',
    );
  });

  it('omits sprop without an origin', () => {
    const url = new URL(googleCalendarUrl(event));
    expect(url.searchParams.get('sprop')).toBeNull();
  });
});
