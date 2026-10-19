/**
 * Timezone-correct helpers for event wall clocks.
 *
 * An `Event.date` is stored as a UTC instant. The wall clock the organizer
 * typed is only recoverable when we also know the IANA zone they typed it in,
 * which is why `Event.timeZone` exists. Nothing in this module touches the DB
 * or request context, so it is safe to import from server components, server
 * actions and standalone `tsx` scripts.
 */

/** Fallback zone for rows created before timezone support, and for no-JS. */
const ENV_TIME_ZONE = process.env.APP_TIME_ZONE?.trim() ?? '';

/** True when `tz` is an IANA zone this runtime's `Intl` understands. */
export function isValidTimeZone(tz: string): boolean {
  if (typeof tz !== 'string' || tz.length === 0) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export const DEFAULT_TIME_ZONE = isValidTimeZone(ENV_TIME_ZONE)
  ? ENV_TIME_ZONE
  : 'UTC';

/**
 * Resolve a possibly-null column value to a usable zone. Every formatter below
 * routes through this, so callers can pass `event.timeZone` directly.
 */
export function resolveTimeZone(tz?: string | null): string {
  return tz && isValidTimeZone(tz) ? tz : DEFAULT_TIME_ZONE;
}

type DateParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

function partsInZone(
  date: Date,
  timeZone: string,
  opts: Intl.DateTimeFormatOptions = {},
): Intl.DateTimeFormatPart[] {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    ...opts,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date);
}

function readPart(parts: Intl.DateTimeFormatPart[], type: string): number {
  return Number(parts.find((part) => part.type === type)?.value);
}

function datePartsInZone(date: Date, timeZone: string): DateParts {
  const parts = partsInZone(date, timeZone);
  return {
    year: readPart(parts, 'year'),
    month: readPart(parts, 'month'),
    day: readPart(parts, 'day'),
    hour: readPart(parts, 'hour'),
    minute: readPart(parts, 'minute'),
    second: readPart(parts, 'second'),
  };
}

/**
 * Offset of `timeZone` from UTC at the given instant, in milliseconds.
 * Seconds precision on purpose: `formatToParts` drops milliseconds.
 */
function zoneOffsetMs(date: Date, timeZone: string): number {
  const parts = datePartsInZone(date, timeZone);
  const wallClockAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  return wallClockAsUtc - (date.getTime() - date.getMilliseconds());
}

const LOCAL_DATE_TIME =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

/**
 * Convert a wall clock (`YYYY-MM-DDTHH:mm`, the value of
 * `<input type="datetime-local">`) in `timeZone` to the true UTC instant.
 *
 * Returns an invalid Date for malformed or rolled-over input (e.g. Feb 31),
 * which callers turn into a validation error.
 *
 * DST edges: a wall clock inside a spring-forward gap shifts to the
 * corresponding instant after the gap; an ambiguous fall-back time resolves to
 * the earlier of the two instants (offset at the naive instant, then one
 * corrective pass). Offsets are therefore exact except within ±1 h of a
 * transition.
 */
export function zonedTimeToUtc(
  local: string,
  timeZone?: string | null,
): Date {
  const match = LOCAL_DATE_TIME.exec(local.trim());
  if (!match) return new Date(NaN);

  const [, y, mo, d, h, mi, s] = match;
  const year = Number(y);
  const month = Number(mo);
  const day = Number(d);
  const hour = Number(h);
  const minute = Number(mi);
  const second = s ? Number(s) : 0;

  const naive = Date.UTC(year, month - 1, day, hour, minute, second);
  const check = new Date(naive);
  if (
    Number.isNaN(naive) ||
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day ||
    check.getUTCHours() !== hour ||
    check.getUTCMinutes() !== minute ||
    check.getUTCSeconds() !== second
  ) {
    return new Date(NaN);
  }

  const zone = resolveTimeZone(timeZone);
  let timestamp = naive - zoneOffsetMs(new Date(naive), zone);
  // Second pass tightens zones whose offset differs between the naive instant
  // and the real instant (DST-adjacent dates).
  const corrected = naive - zoneOffsetMs(new Date(timestamp), zone);
  if (corrected !== timestamp) timestamp = corrected;
  return new Date(timestamp);
}

/** Human-readable wall clock in the event's zone, with its abbreviation. */
export function formatEventDate(
  date: Date,
  timeZone?: string | null,
): string {
  return date.toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: resolveTimeZone(timeZone),
    timeZoneName: 'short',
  });
}

/** Inverse of `zonedTimeToUtc` for `<input type="datetime-local">` values. */
export function toDatetimeLocalValue(
  date: Date,
  timeZone?: string | null,
): string {
  const parts = datePartsInZone(date, resolveTimeZone(timeZone));
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${parts.year}-${pad(parts.month)}-${pad(parts.day)}` +
    `T${pad(parts.hour)}:${pad(parts.minute)}`
  );
}

/** Calendar date (`YYYY-MM-DD`) at `date` as seen in `timeZone`. */
export function dayKeyIn(date: Date, timeZone?: string | null): string {
  const parts = datePartsInZone(date, resolveTimeZone(timeZone));
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
}

/** Midnight at the start of `date`'s calendar day in `timeZone`. */
export function startOfDayIn(
  date: Date,
  timeZone?: string | null,
): Date {
  const zone = resolveTimeZone(timeZone);
  return zonedTimeToUtc(`${dayKeyIn(date, zone)}T00:00`, zone);
}

/**
 * Midnight `days` calendar days after `date` in `timeZone`. Days are added to
 * the calendar key before converting back, so DST days (23/25 h) still land on
 * local midnight instead of drifting an hour.
 */
export function addDaysInZone(
  date: Date,
  days: number,
  timeZone?: string | null,
): Date {
  const zone = resolveTimeZone(timeZone);
  const [year, month, day] = dayKeyIn(date, zone).split('-').map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  const pad = (n: number) => String(n).padStart(2, '0');
  const key =
    `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}` +
    `-${pad(shifted.getUTCDate())}`;
  return zonedTimeToUtc(`${key}T00:00`, zone);
}

/**
 * Whole calendar days from `now` to `target`, in the same zone. Used for
 * "Today"/"Tomorrow"/"In N days" labels; immune to DST-length days.
 */
export function calendarDayDiffInZone(
  target: Date,
  now: Date,
  timeZone?: string | null,
): number {
  const zone = resolveTimeZone(timeZone);
  const key = (date: Date) => Date.parse(`${dayKeyIn(date, zone)}T00:00:00Z`);
  return Math.round((key(target) - key(now)) / (24 * 60 * 60 * 1000));
}
