import { prisma } from '@/db';

/** Shared client-facing message for every throttled action. */
export const RATE_LIMIT_MESSAGE = 'Too many requests — please wait a moment.';

export type RateLimitScope =
  | 'comment'
  | 'rsvp'
  | 'invite'
  | 'accept'
  | 'eventEdit';

/**
 * Per-user budgets for the actions that write (or fan out notifications).
 * `comment` is tightest because one comment fans out up to 20 notifications;
 * `eventEdit` fans out to every holder of the event.
 */
export const RATE_LIMITS: Record<
  RateLimitScope,
  { limit: number; windowMs: number }
> = {
  comment: { limit: 5, windowMs: 60_000 },
  rsvp: { limit: 30, windowMs: 60_000 },
  invite: { limit: 10, windowMs: 60_000 },
  accept: { limit: 10, windowMs: 60_000 },
  eventEdit: { limit: 10, windowMs: 60_000 },
};

/**
 * Fixed-window counter in Postgres (this stack has no Redis).
 *
 * One atomic statement: insert-or-increment, resetting the window when it has
 * elapsed. `ON CONFLICT ("key")` is valid because `key` is the primary key, so
 * concurrent callers cannot both read then write the same count. Returns false
 * once the current window's count exceeds `limit`.
 *
 * `windowStart` is timestamptz, so the `now() - interval` comparison needs no
 * session-timezone conversion.
 */
export async function consume(
  key: string,
  limit: number,
  windowMs: number,
): Promise<boolean> {
  const rows = await prisma.$queryRaw<{ count: number }[]>`
    INSERT INTO "RateLimit" ("key", "count", "windowStart")
    VALUES (${key}, 1, now())
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE
        WHEN "RateLimit"."windowStart" < now() - (${windowMs}::int * interval '1 millisecond')
        THEN 1
        ELSE "RateLimit"."count" + 1
      END,
      "windowStart" = CASE
        WHEN "RateLimit"."windowStart" < now() - (${windowMs}::int * interval '1 millisecond')
        THEN now()
        ELSE "RateLimit"."windowStart"
      END
    RETURNING "count"
  `;
  return Number(rows[0]?.count ?? 1) <= limit;
}

/**
 * Lazy cleanup of rows whose window is long past. Rows are tiny, but the table
 * is otherwise unbounded; sweeping every Nth call keeps it out of the request
 * path for all but a rare caller. Failures are logged, never surfaced.
 */
const CLEANUP_EVERY = 500;
const CLEANUP_AGE_MS = 24 * 60 * 60 * 1000;
let callsSinceCleanup = 0;

/** Delete counters whose window ended before `olderThan`. Returns rows removed. */
export async function deleteStaleRateLimits(olderThan: Date): Promise<number> {
  const result = await prisma.rateLimit.deleteMany({
    where: { windowStart: { lt: olderThan } },
  });
  return result.count;
}

async function sweepStaleRows(): Promise<void> {
  callsSinceCleanup += 1;
  if (callsSinceCleanup < CLEANUP_EVERY) return;
  callsSinceCleanup = 0;
  try {
    await deleteStaleRateLimits(new Date(Date.now() - CLEANUP_AGE_MS));
  } catch (error) {
    console.error('rate limit cleanup failed', { error });
  }
}

/**
 * Enforce the per-user budget for `scope`. Returns a client-facing error object
 * for the action to return, or null when the caller may proceed.
 *
 * Fails **open**: a limiter outage (missing table, DB error) must not take down
 * commenting or RSVP, and during a real DB outage the action fails anyway.
 * Callers invoke this after the auth guard, so only authenticated users are
 * counted and keys are `{scope}:{userId}`.
 */
export async function enforceRateLimit(
  scope: RateLimitScope,
  userId: string,
): Promise<{ ok: false; error: string } | null> {
  const { limit, windowMs } = RATE_LIMITS[scope];
  try {
    await sweepStaleRows();
    const allowed = await consume(`${scope}:${userId}`, limit, windowMs);
    return allowed ? null : { ok: false, error: RATE_LIMIT_MESSAGE };
  } catch (error) {
    console.error('rate limit check failed (failing open)', { scope, error });
    return null;
  }
}
