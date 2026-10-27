import { describe, expect, it, vi } from 'vitest';
import {
  addDaysInZone,
  calendarDayDiffInZone,
  DEFAULT_TIME_ZONE,
  formatEventDate,
  isValidTimeZone,
  resolveTimeZone,
  startOfDayIn,
  toDatetimeLocalValue,
  zonedTimeToUtc,
} from '@/lib/time';

/**
 * Ported from `scripts/timezone-check.ts` (same invariants, real assertions).
 * `APP_TIME_ZONE=Europe/Berlin` is set by tests/setup/unit.ts.
 */
describe('time zones', () => {
  it('uses the configured fallback zone', () => {
    expect(DEFAULT_TIME_ZONE).toBe('Europe/Berlin');
    expect(resolveTimeZone(null)).toBe('Europe/Berlin');
    expect(resolveTimeZone(undefined)).toBe('Europe/Berlin');
    expect(resolveTimeZone('Not/AZone')).toBe('Europe/Berlin');
    expect(resolveTimeZone('Europe/Berlin')).toBe('Europe/Berlin');
  });

  it('validates IANA zones', () => {
    expect(isValidTimeZone('Europe/Berlin')).toBe(true);
    expect(isValidTimeZone('America/New_York')).toBe(true);
    expect(isValidTimeZone('')).toBe(false);
    expect(isValidTimeZone('Not/AZone')).toBe(false);
  });

  it('falls back to UTC when APP_TIME_ZONE is unset', async () => {
    vi.resetModules();
    vi.stubEnv('APP_TIME_ZONE', '');
    const mod = await import('@/lib/time');
    expect(mod.DEFAULT_TIME_ZONE).toBe('UTC');
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('falls back to UTC when APP_TIME_ZONE is invalid', async () => {
    vi.resetModules();
    vi.stubEnv('APP_TIME_ZONE', 'Not/AZone');
    const mod = await import('@/lib/time');
    expect(mod.DEFAULT_TIME_ZONE).toBe('UTC');
    vi.unstubAllEnvs();
    vi.resetModules();
  });
});

describe('formatEventDate', () => {
  const instant = new Date('2026-10-20T18:00:00Z');

  it('renders the wall clock in the requested zone', () => {
    const ny = formatEventDate(instant, 'America/New_York');
    expect(ny).toContain('Oct 20');
    expect(ny).toContain('2:00 PM');
    expect(ny).toContain('EDT');
  });

  it('rolls the calendar day in zones ahead of UTC', () => {
    const tokyo = formatEventDate(instant, 'Asia/Tokyo');
    expect(tokyo).toContain('Oct 21');
    expect(tokyo).toContain('3:00 AM');
  });

  it('uses the app fallback for legacy null rows', () => {
    expect(formatEventDate(instant, null)).toContain('Oct 20');
  });
});

describe('zonedTimeToUtc', () => {
  it('converts a wall clock in the given zone', () => {
    expect(
      zonedTimeToUtc('2026-10-20T18:00', 'America/New_York').toISOString(),
    ).toBe('2026-10-20T22:00:00.000Z');
  });

  it('accepts seconds', () => {
    expect(
      zonedTimeToUtc('2026-10-20T18:00:30', 'Europe/Berlin').toISOString(),
    ).toBe('2026-10-20T16:00:30.000Z');
  });

  it('trims surrounding whitespace', () => {
    expect(
      zonedTimeToUtc('  2026-10-20T18:00  ', 'Europe/Berlin').toISOString(),
    ).toBe('2026-10-20T16:00:00.000Z');
  });

  it('rejects rolled-over and malformed input', () => {
    expect(Number.isNaN(zonedTimeToUtc('2026-02-31T10:00', 'UTC').getTime())).toBe(
      true,
    );
    expect(Number.isNaN(zonedTimeToUtc('2026-10-20T24:00', 'UTC').getTime())).toBe(
      true,
    );
    expect(Number.isNaN(zonedTimeToUtc('tomorrow', 'UTC').getTime())).toBe(true);
  });

  it('round-trips instants through datetime-local values', () => {
    const zones = ['UTC', 'America/New_York', 'Europe/Berlin', 'Asia/Tokyo'];
    const instants = [
      '2026-06-15T12:34:00.000Z',
      '2026-01-15T12:34:00.000Z',
      '2026-03-08T07:30:00.000Z',
      '2026-11-01T05:30:00.000Z',
    ];
    for (const zone of zones) {
      for (const iso of instants) {
        const date = new Date(iso);
        const roundTrip = zonedTimeToUtc(
          toDatetimeLocalValue(date, zone),
          zone,
        );
        expect(roundTrip.toISOString(), `${zone} ${iso}`).toBe(date.toISOString());
      }
    }
  });

  // Current behavior, asserted so a future change is deliberate:
  // 02:30 on the US spring-forward day does not exist; the two-pass offset
  // correction resolves it to 01:30 EST (the pre-gap instant), not 03:30 EDT.
  it('documents spring-forward gap resolution', () => {
    expect(
      zonedTimeToUtc('2026-03-08T02:30', 'America/New_York').toISOString(),
    ).toBe('2026-03-08T06:30:00.000Z');
  });

  it('resolves ambiguous fall-back times to the earlier instant', () => {
    expect(
      zonedTimeToUtc('2026-11-01T01:30', 'America/New_York').toISOString(),
    ).toBe('2026-11-01T05:30:00.000Z');
  });
});

describe('calendar day helpers', () => {
  it('starts the day at local midnight', () => {
    expect(
      startOfDayIn(
        new Date('2026-06-15T12:00:00Z'),
        'America/New_York',
      ).toISOString(),
    ).toBe('2026-06-15T04:00:00.000Z');
  });

  it('adds days without drifting across DST', () => {
    expect(
      addDaysInZone(
        new Date('2026-03-07T12:00:00Z'),
        1,
        'America/New_York',
      ).toISOString(),
    ).toBe('2026-03-08T05:00:00.000Z');
  });

  it('lands on local midnight across the 25-hour fall-back day', () => {
    // Oct 31 -> Nov 1 is 25 hours long in New York; both results are midnight
    // local time, so the UTC offsets differ by an hour.
    expect(
      addDaysInZone(
        new Date('2026-10-31T12:00:00Z'),
        1,
        'America/New_York',
      ).toISOString(),
    ).toBe('2026-11-01T04:00:00.000Z');
    expect(
      addDaysInZone(
        new Date('2026-10-31T12:00:00Z'),
        2,
        'America/New_York',
      ).toISOString(),
    ).toBe('2026-11-02T05:00:00.000Z');
  });

  it('emits the exact datetime-local shape', () => {
    expect(
      toDatetimeLocalValue(new Date('2026-10-20T18:00:00Z'), 'America/New_York'),
    ).toBe('2026-10-20T14:00');
    expect(
      toDatetimeLocalValue(new Date('2026-01-05T08:07:09Z'), 'UTC'),
    ).toBe('2026-01-05T08:07');
  });

  it('compares calendar days in the same zone', () => {
    expect(
      calendarDayDiffInZone(
        new Date('2026-06-16T02:00:00Z'),
        new Date('2026-06-15T12:00:00Z'),
        'America/New_York',
      ),
    ).toBe(0);
    expect(
      calendarDayDiffInZone(
        new Date('2026-06-16T12:00:00Z'),
        new Date('2026-06-15T12:00:00Z'),
        'America/New_York',
      ),
    ).toBe(1);
  });
});
