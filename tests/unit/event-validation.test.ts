import { describe, expect, it } from 'vitest';
import { parseEventForm } from '@/lib/event-validation';
import { DEFAULT_TIME_ZONE, zonedTimeToUtc } from '@/lib/time';

/**
 * Ported from the form-parsing half of `scripts/timezone-check.ts` and
 * extended to the documented validation limits.
 */
function eventForm(overrides: Record<string, string> = {}): FormData {
  const base: Record<string, string> = {
    title: 'probe',
    description: 'probe',
    location: 'probe',
    date: '2026-10-20T18:00',
    timeZone: 'Europe/Berlin',
    category: 'MUSIC',
    maxAttendees: '',
    isPublic: 'on',
  };
  const data = new FormData();
  for (const [key, value] of Object.entries({ ...base, ...overrides })) {
    data.set(key, value);
  }
  return data;
}

function futureWallClock(hours = 24): string {
  return new Date(Date.now() + hours * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 16);
}

const edit = { requireFutureDate: false } as const;
const create = { requireFutureDate: true } as const;

describe('parseEventForm required fields', () => {
  it('accepts a well-formed submit', () => {
    const parsed = parseEventForm(eventForm(), edit);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.data.date.toISOString()).toBe('2026-10-20T16:00:00.000Z');
    expect(parsed.data.timeZone).toBe('Europe/Berlin');
    expect(parsed.data.category).toBe('MUSIC');
    expect(parsed.data.isPublic).toBe(true);
    expect(parsed.data.maxAttendees).toBeNull();
  });

  it('trims persisted fields', () => {
    const parsed = parseEventForm(
      eventForm({ title: '  T  ', description: '  D  ', location: '  L  ' }),
      edit,
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.data.title).toBe('T');
    expect(parsed.data.description).toBe('D');
    expect(parsed.data.location).toBe('L');
  });

  it('rejects missing or blank required fields', () => {
    expect(parseEventForm(eventForm({ title: '   ' }), edit)).toEqual({
      ok: false,
      error: 'Title is required.',
    });
    expect(parseEventForm(eventForm({ description: '' }), edit)).toEqual({
      ok: false,
      error: 'Description is required.',
    });
    expect(parseEventForm(eventForm({ location: '' }), edit)).toEqual({
      ok: false,
      error: 'Location is required.',
    });
  });

  it('enforces field length limits', () => {
    expect(parseEventForm(eventForm({ title: 'x'.repeat(201) }), edit)).toEqual({
      ok: false,
      error: 'Title must be 200 characters or fewer.',
    });
    expect(
      parseEventForm(eventForm({ description: 'x'.repeat(5001) }), edit),
    ).toEqual({
      ok: false,
      error: 'Description must be 5000 characters or fewer.',
    });
    expect(parseEventForm(eventForm({ location: 'x'.repeat(301) }), edit)).toEqual(
      { ok: false, error: 'Location must be 300 characters or fewer.' },
    );
  });

  it('keeps valid categories and falls back to OTHER', () => {
    const valid = parseEventForm(eventForm({ category: 'TECH' }), edit);
    expect(valid.ok && valid.data.category).toBe('TECH');
    const unknown = parseEventForm(eventForm({ category: 'NOPE' }), edit);
    expect(unknown.ok && unknown.data.category).toBe('OTHER');
    const missing = parseEventForm(eventForm({ category: '' }), edit);
    expect(missing.ok && missing.data.category).toBe('OTHER');
  });

  it('treats a missing isPublic value as private', () => {
    const parsed = parseEventForm(eventForm({ isPublic: '' }), edit);
    expect(parsed.ok && parsed.data.isPublic).toBe(false);
  });
});

describe('parseEventForm capacity', () => {
  it('treats an empty capacity as uncapped', () => {
    const parsed = parseEventForm(eventForm({ maxAttendees: '' }), edit);
    expect(parsed.ok && parsed.data.maxAttendees).toBeNull();
  });

  it('accepts a positive whole number', () => {
    const parsed = parseEventForm(eventForm({ maxAttendees: '42' }), edit);
    expect(parsed.ok && parsed.data.maxAttendees).toBe(42);
  });

  it('rejects non-integers, zero, negatives, and huge values', () => {
    for (const value of ['1.5', '0', '-3', 'abc']) {
      expect(parseEventForm(eventForm({ maxAttendees: value }), edit)).toEqual({
        ok: false,
        error: 'Capacity must be a whole number of at least 1.',
      });
    }
    expect(parseEventForm(eventForm({ maxAttendees: '100001' }), edit)).toEqual({
      ok: false,
      error: 'Capacity must be 100,000 or fewer.',
    });
  });
});

describe('parseEventForm dates and zones', () => {
  it('requires a future date on create', () => {
    expect(
      parseEventForm(
        eventForm({ date: '2020-01-01T10:00', timeZone: 'UTC' }),
        create,
      ),
    ).toEqual({ ok: false, error: 'Event date must be in the future.' });
  });

  it('allows a past date on edit', () => {
    const parsed = parseEventForm(
      eventForm({ date: '2020-01-01T10:00', timeZone: 'UTC' }),
      edit,
    );
    expect(parsed.ok).toBe(true);
  });

  it('accepts a future create date', () => {
    const parsed = parseEventForm(
      eventForm({ date: futureWallClock(), timeZone: 'UTC' }),
      create,
    );
    expect(parsed.ok).toBe(true);
  });

  it('leaves the zone null and uses the app fallback when missing', () => {
    const noJs = parseEventForm(eventForm({ timeZone: '' }), edit);
    expect(noJs.ok).toBe(true);
    if (!noJs.ok) return;
    expect(noJs.data.timeZone).toBeNull();
    expect(noJs.data.date.toISOString()).toBe(
      zonedTimeToUtc('2026-10-20T18:00', DEFAULT_TIME_ZONE).toISOString(),
    );
  });

  it('drops an invalid/spoofed zone', () => {
    const spoofed = parseEventForm(eventForm({ timeZone: 'Not/AZone' }), edit);
    expect(spoofed.ok).toBe(true);
    if (!spoofed.ok) return;
    expect(spoofed.data.timeZone).toBeNull();
  });

  it('rejects a rolled-over calendar date', () => {
    expect(
      parseEventForm(eventForm({ date: '2026-02-31T10:00' }), edit),
    ).toEqual({ ok: false, error: 'A valid date and time is required.' });
  });

  it('rejects a missing date', () => {
    expect(parseEventForm(eventForm({ date: '' }), edit)).toEqual({
      ok: false,
      error: 'A valid date and time is required.',
    });
  });
});
