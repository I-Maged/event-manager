/**
 * Manual / external-scheduler entry point for the RateLimit GC.
 *
 * The authoritative scheduled job is the Neon Function + Function Trigger
 * declared in `neon.ts` (see `functions/rate-limit-cleanup.ts` and
 * `docs/operations.md`). This script runs the identical delete by hand, from
 * CI, or from any other scheduler, and reuses the app's Prisma client so it
 * cannot drift from the schema.
 *
 *   npx tsx scripts/rate-limit-cleanup.ts                    # dry run (count only)
 *   npx tsx scripts/rate-limit-cleanup.ts --apply            # delete
 *
 * Unlike the destructive dev probes, this job is meant to run against
 * production, so it prints the resolved host but does not require
 * `--allow-writes`; `--apply` is the explicit opt-in to write.
 */
import 'dotenv/config';
import { prisma } from '@/db';
import { deleteStaleRateLimits } from '@/lib/rate-limit';
import { describeDatabaseTarget } from './preflight';

/** Must match the SQL job body and `CLEANUP_AGE_MS` in `src/lib/rate-limit.ts`. */
const CLEANUP_AGE_MS = 24 * 60 * 60 * 1000;

const apply = process.argv.includes('--apply');

async function main(): Promise<void> {
  console.log(`rate-limit-cleanup database target:\n${describeDatabaseTarget()}`);
  const cutoff = new Date(Date.now() - CLEANUP_AGE_MS);

  if (!apply) {
    const stale = await prisma.rateLimit.count({
      where: { windowStart: { lt: cutoff } },
    });
    console.log(
      `${stale} RateLimit row(s) older than ${cutoff.toISOString()}; dry run.`,
    );
    console.log('Re-run with --apply to delete.');
    return;
  }

  const removed = await deleteStaleRateLimits(cutoff);
  console.log(`Deleted ${removed} RateLimit row(s) older than ${cutoff.toISOString()}.`);
}

main()
  .catch((error: unknown) => {
    console.error(
      'rate-limit-cleanup failed:',
      error instanceof Error ? (error.stack ?? error.message) : error,
    );
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
