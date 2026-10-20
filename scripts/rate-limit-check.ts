/**
 * Rate-limit probe — DEV BRANCH ONLY (writes and deletes `probe:` rows).
 *
 *   npx tsx scripts/rate-limit-check.ts --allow-writes
 *
 * Proves the fixed-window counter is atomic under concurrency, resets after
 * its window, and that the lazy sweep removes stale rows. Writes are refused
 * unless `--allow-writes` (or `PROBE_ALLOW=1`) is passed; see
 * `scripts/preflight.ts`. Exit code 0 = all invariants held, 1 = one broke.
 */
import 'dotenv/config';
import { prisma } from '@/db';
import {
  consume,
  deleteStaleRateLimits,
  RATE_LIMIT_MESSAGE,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import { requireProbeTarget } from './preflight';

const failures: string[] = [];

function check(label: string, condition: boolean, detail = ''): void {
  if (!condition) failures.push(detail ? `${label} — ${detail}` : label);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main(): Promise<number> {
  requireProbeTarget('rate-limit-check');
  const tag = `probe:${Date.now()}`;

  try {
    // --- sequential budget -------------------------------------------------
    const key = `${tag}:seq`;
    for (let i = 1; i <= 5; i += 1) {
      const allowed = await consume(key, 5, 60_000);
      check(`call ${i} allowed`, allowed === true);
    }
    check('call 6 blocked', (await consume(key, 5, 60_000)) === false);
    check('call 7 blocked', (await consume(key, 5, 60_000)) === false);

    // --- concurrency: exactly `limit` winners ------------------------------
    const raceKey = `${tag}:race`;
    const results = await Promise.all(
      Array.from({ length: 20 }, () => consume(raceKey, 5, 60_000)),
    );
    const allowedCount = results.filter(Boolean).length;
    check('20 racers -> exactly 5 allowed', allowedCount === 5, `got ${allowedCount}`);

    // --- window reset ------------------------------------------------------
    // Generous window: each Neon round trip is tens of ms, so a 50 ms window
    // would elapse between the two calls.
    const resetKey = `${tag}:reset`;
    check('short window first call', (await consume(resetKey, 1, 1500)) === true);
    check('short window second call blocked', (await consume(resetKey, 1, 1500)) === false);
    await sleep(1800);
    check('short window resets', (await consume(resetKey, 1, 1500)) === true);

    // --- sweep -------------------------------------------------------------
    const staleKey = `${tag}:stale`;
    await prisma.rateLimit.create({
      data: { key: staleKey, count: 3, windowStart: new Date(Date.now() - 48 * 60 * 60 * 1000) },
    });
    const removed = await deleteStaleRateLimits(new Date(Date.now() - 24 * 60 * 60 * 1000));
    check('sweep removed stale row', removed >= 1, `removed ${removed}`);
    const stale = await prisma.rateLimit.findUnique({ where: { key: staleKey } });
    check('stale row is gone', stale === null);

    // --- shape guards ------------------------------------------------------
    check('message is non-empty', RATE_LIMIT_MESSAGE.length > 0);
    check('comment budget is the tightest', RATE_LIMITS.comment.limit < RATE_LIMITS.rsvp.limit);

    // Every scope declared in `RateLimitScope` must have a positive budget.
    const expectedScopes = [
      'comment',
      'rsvp',
      'invite',
      'accept',
      'eventEdit',
      'eventCreate',
      'commentDelete',
      'checkIn',
    ] as const;
    for (const scope of expectedScopes) {
      const budget = RATE_LIMITS[scope];
      check(
        `${scope} scope has a budget`,
        budget != null && budget.limit > 0 && budget.windowMs > 0,
        JSON.stringify(budget),
      );
    }
    check(
      'all declared budgets are positive',
      Object.values(RATE_LIMITS).every((b) => b.limit > 0 && b.windowMs > 0),
    );

    // Coverage-hardening scopes (see hanging_items.md H3.3).
    check(
      'eventCreate is bounded at 10/hour',
      RATE_LIMITS.eventCreate.limit === 10 &&
        RATE_LIMITS.eventCreate.windowMs === 60 * 60_000,
    );
    check(
      'commentDelete is bounded at 30/minute',
      RATE_LIMITS.commentDelete.limit === 30 &&
        RATE_LIMITS.commentDelete.windowMs === 60_000,
    );
    check(
      'checkIn is bounded at 60/minute',
      RATE_LIMITS.checkIn.limit === 60 && RATE_LIMITS.checkIn.windowMs === 60_000,
    );
  } finally {
    await prisma.rateLimit.deleteMany({ where: { key: { startsWith: 'probe:' } } });
    await prisma.$disconnect();
  }

  if (failures.length > 0) {
    console.error(`\n${failures.length} rate-limit invariant failure(s):`);
    for (const failure of failures) console.error(`  - ${failure}`);
    return 1;
  }
  console.log('Rate-limit probe: all invariants held.');
  return 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    console.error(
      'probe run failed:',
      error instanceof Error ? (error.stack ?? error.message) : error,
    );
    process.exitCode = 1;
  });
