/**
 * One-off backfill for legacy `Event.timeZone` rows.
 *
 *   npx tsx scripts/backfill-time-zone.ts                 # dry run (no writes)
 *   npx tsx scripts/backfill-time-zone.ts --apply --allow-writes
 *
 * Only run this when the audience is effectively single-zone: it stamps every
 * `timeZone = null` row with `APP_TIME_ZONE`, which is also how those rows
 * already render. If events were authored in different zones, do NOT guess —
 * leave the column null and rely on APP_TIME_ZONE, or let organizers correct
 * individual events in the edit form.
 */
import 'dotenv/config';
import { prisma } from '@/db';
import { DEFAULT_TIME_ZONE, isValidTimeZone } from '@/lib/time';
import { describeDatabaseTarget, requireProbeTarget } from './preflight';

const apply = process.argv.includes('--apply');
const zone = process.env.APP_TIME_ZONE?.trim() || DEFAULT_TIME_ZONE;

async function main(): Promise<void> {
  if (!isValidTimeZone(zone)) {
    console.error(`APP_TIME_ZONE is not a valid IANA zone: ${zone}`);
    process.exitCode = 1;
    return;
  }

  if (apply) requireProbeTarget('backfill-time-zone');
  else console.log(`backfill-time-zone database target:\n${describeDatabaseTarget()}`);

  const missing = await prisma.event.count({ where: { timeZone: null } });
  console.log(`${missing} event(s) have timeZone = null; target zone: ${zone}`);

  if (!apply) {
    console.log('Dry run — re-run with --apply --allow-writes to write.');
    return;
  }
  if (missing === 0) return;

  const result = await prisma.event.updateMany({
    where: { timeZone: null },
    data: { timeZone: zone },
  });
  console.log(`Backfilled ${result.count} event(s) with ${zone}.`);
}

main()
  .catch((error: unknown) => {
    console.error(
      'backfill failed:',
      error instanceof Error ? (error.stack ?? error.message) : error,
    );
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
