/**
 * RateLimit garbage collection as a Neon Function.
 *
 * Invoked by the `rate-limit-gc-hourly` Function Trigger declared in `neon.ts`
 * (`cron: "17 * * * *"`, UTC). The trigger POSTs to this handler without
 * credentials, so the handler only acts on calls that carry Neon's
 * `X-Neon-Trigger-Invocation-Id` header (Neon strips client-set `X-Neon-*`
 * headers, so its presence attests the call came from the trigger system).
 *
 * The delete is the same predicate as `scripts/sql/rate-limit-cleanup.sql` and
 * matches `CLEANUP_AGE_MS` in `src/lib/rate-limit.ts`, where the in-process
 * sweep is documented as best effort. This job is the authoritative GC.
 *
 * A long-lived `pg` Pool is created once at module scope (the recommended
 * pattern for Neon Functions) instead of the serverless driver, which opens a
 * connection per request.
 */
import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 1,
});

// Without a listener, an idle client dropped by the pooler / scale-to-zero
// becomes an uncaught exception that kills the isolate.
pool.on('error', (error) => {
  console.error('rate-limit GC idle client error', { error });
});

const CLEANUP_SQL =
  'DELETE FROM "RateLimit" WHERE "windowStart" < now() - interval \'1 day\'';

export type CleanupQuery = () => Promise<{ rowCount: number | null }>;
export type CleanupHandler = { fetch(request: Request): Promise<Response> };

/**
 * Handler factory so the trigger-header guard and the delete/failure branches
 * can be tested without a live pool. The default export below wires it to the
 * module-level pool.
 */
export function createRateLimitCleanupHandler(
  runCleanup: CleanupQuery,
): CleanupHandler {
  return {
    async fetch(request: Request): Promise<Response> {
      if (!request.headers.get('x-neon-trigger-invocation-id')) {
        return Response.json({ error: 'not a trigger call' }, { status: 403 });
      }
      try {
        const result = await runCleanup();
        const deleted = result.rowCount ?? 0;
        console.log('rate-limit GC complete', { deleted });
        return Response.json({ ok: true, deleted });
      } catch (error) {
        console.error('rate-limit GC failed', { error });
        return Response.json({ ok: false }, { status: 500 });
      }
    },
  };
}

const handler = createRateLimitCleanupHandler(() => pool.query(CLEANUP_SQL));

export default handler;
