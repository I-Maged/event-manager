-- RateLimit garbage collection.
--
-- The in-process sweep in src/lib/rate-limit.ts is best effort only: its
-- counter is module state, so on serverless it may never reach the threshold
-- per instance. This job is the authoritative GC.
--
-- Schedule it (e.g. hourly) as a Neon scheduled function / cron against
-- DATABASE_URL_UNPOOLED. See the `neon` skill for the scheduling workflow.

DELETE FROM "RateLimit" WHERE "windowStart" < now() - interval '1 day';
