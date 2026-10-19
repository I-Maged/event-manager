/**
 * Timezone helper probe — read-only, safe on any branch.
 *
 *   npx tsx scripts/timezone-check.ts
 *
 * Verifies wall-clock <-> instant conversion, zone-aware display, DST day
 * boundaries and input rejection. Exit code 0 = all assertions held, 1 = at
 * least one broke.
 */
import 'dotenv/config';
import { parseEventForm } from '@/lib/event-validation';
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

const failures: string[] = [];

function check(label: string, condition: boolean, detail = ''): void {
  if (!condition) failures.push(detail ? `${label} — ${detail}` : label);
}

function eq(label: string, actual: unknown, expected: unknown): void {
  check(
    label,
    Object.is(actual, expected),
    `got ${String(actual)}, expected ${String(expected)}`,
  );
}

// --- zone resolution -------------------------------------------------------
check('DEFAULT_TIME_ZONE is set', DEFAULT_TIME_ZONE.length > 0);
eq('resolveTimeZone(null)', resolveTimeZone(null), DEFAULT_TIME_ZONE);
eq('resolveTimeZone(undefined)', resolveTimeZone(undefined), DEFAULT_TIME_ZONE);
eq('resolveTimeZone(invalid)', resolveTimeZone('Not/AZone'), DEFAULT_TIME_ZONE);
eq('resolveTimeZone(valid)', resolveTimeZone('Europe/Berlin'), 'Europe/Berlin');
eq('isValidTimeZone(valid)', isValidTimeZone('Europe/Berlin'), true);
eq('isValidTimeZone(empty)', isValidTimeZone(''), false);
eq('isValidTimeZone(invalid)', isValidTimeZone('Not/AZone'), false);

// --- display ---------------------------------------------------------------
const instant = new Date('2026-10-20T18:00:00Z');
const ny = formatEventDate(instant, 'America/New_York');
check('NY display is Oct 20, 2:00 PM', ny.includes('Oct 20') && ny.includes('2:00 PM'), ny);
check('NY display carries EDT', ny.includes('EDT'), ny);
const tokyo = formatEventDate(instant, 'Asia/Tokyo');
check('Tokyo display rolls to Oct 21, 3:00 AM', tokyo.includes('Oct 21') && tokyo.includes('3:00 AM'), tokyo);
check('legacy null zone falls back to default', formatEventDate(instant, null).includes('Oct 20'), 'expected UTC Oct 20 6:00 PM');

// --- conversion ------------------------------------------------------------
eq(
  'zonedTimeToUtc(NY 18:00)',
  zonedTimeToUtc('2026-10-20T18:00', 'America/New_York').toISOString(),
  '2026-10-20T22:00:00.000Z',
);
eq(
  'zonedTimeToUtc(seconds)',
  zonedTimeToUtc('2026-10-20T18:00:30', 'Europe/Berlin').toISOString(),
  '2026-10-20T16:00:30.000Z',
);
check('rejects Feb 31', Number.isNaN(zonedTimeToUtc('2026-02-31T10:00', 'UTC').getTime()));
check('rejects hour 24', Number.isNaN(zonedTimeToUtc('2026-10-20T24:00', 'UTC').getTime()));
check('rejects garbage', Number.isNaN(zonedTimeToUtc('tomorrow', 'UTC').getTime()));

// --- round trip ------------------------------------------------------------
const ZONES = ['UTC', 'America/New_York', 'Europe/Berlin', 'Asia/Tokyo'];
const INSTANTS = [
  '2026-06-15T12:34:00.000Z',
  '2026-01-15T12:34:00.000Z',
  '2026-03-08T07:30:00.000Z', // US spring-forward
  '2026-11-01T05:30:00.000Z', // US fall-back
];
for (const zone of ZONES) {
  for (const iso of INSTANTS) {
    const date = new Date(iso);
    const roundTrip = zonedTimeToUtc(toDatetimeLocalValue(date, zone), zone);
    eq(`round trip ${zone} ${iso}`, roundTrip.toISOString(), date.toISOString());
  }
}

// --- day boundaries --------------------------------------------------------
eq(
  'startOfDayIn(NY) is local midnight',
  startOfDayIn(new Date('2026-06-15T12:00:00Z'), 'America/New_York').toISOString(),
  '2026-06-15T04:00:00.000Z',
);
eq(
  'addDaysInZone crosses DST to local midnight',
  addDaysInZone(new Date('2026-03-07T12:00:00Z'), 1, 'America/New_York').toISOString(),
  '2026-03-08T05:00:00.000Z',
);
eq(
  'calendarDayDiffInZone same local day',
  calendarDayDiffInZone(
    new Date('2026-06-16T02:00:00Z'),
    new Date('2026-06-15T12:00:00Z'),
    'America/New_York',
  ),
  0,
);
eq(
  'calendarDayDiffInZone next local day',
  calendarDayDiffInZone(
    new Date('2026-06-16T12:00:00Z'),
    new Date('2026-06-15T12:00:00Z'),
    'America/New_York',
  ),
  1,
);

// --- form parsing (no DB) --------------------------------------------------
function eventForm(overrides: Record<string, string>): FormData {
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

const parsed = parseEventForm(eventForm({}), { requireFutureDate: false });
check('parseEventForm accepts a well-formed submit', parsed.ok === true);
if (parsed.ok) {
  eq(
    'parseEventForm stores the author\'s instant',
    parsed.data.date.toISOString(),
    '2026-10-20T16:00:00.000Z',
  );
  eq('parseEventForm keeps the zone', parsed.data.timeZone, 'Europe/Berlin');
}

const noJs = parseEventForm(eventForm({ timeZone: '' }), {
  requireFutureDate: false,
});
if (noJs.ok) {
  eq('no-JS submit leaves the zone null', noJs.data.timeZone, null);
  eq(
    'no-JS submit is parsed in DEFAULT_TIME_ZONE',
    noJs.data.date.toISOString(),
    zonedTimeToUtc('2026-10-20T18:00', DEFAULT_TIME_ZONE).toISOString(),
  );
}

const spoofed = parseEventForm(eventForm({ timeZone: 'Not/AZone' }), {
  requireFutureDate: false,
});
if (spoofed.ok) eq('invalid zone is dropped', spoofed.data.timeZone, null);

const rolled = parseEventForm(eventForm({ date: '2026-02-31T10:00' }), {
  requireFutureDate: false,
});
check('parseEventForm rejects a rolled-over date', rolled.ok === false);


if (failures.length > 0) {
  console.error(`\n${failures.length} timezone assertion failure(s):`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exitCode = 1;
} else {
  console.log('Timezone probe: all assertions held.');
}
