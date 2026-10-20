# Operations

Runbooks for the scheduled / background work this app relies on.

## RateLimit garbage collection (hourly)

`src/lib/rate-limit.ts` sweeps stale counters inline every 500th call, but that
counter is module state, so on serverless it may never fire per process. The
inline sweep is best effort only; **the scheduled job is the source of truth**.

The job is a Neon Function invoked by a Function Trigger, both declared in
`neon.ts`:

| Piece | Where |
|---|---|
| Schedule declaration | `neon.ts` → `triggers["rate-limit-gc-hourly"]` (`cron "17 * * * *"`, UTC) |
| Function slug | `ratelimitgc` |
| Handler | `functions/rate-limit-cleanup.ts` |
| SQL predicate (canonical body) | `scripts/sql/rate-limit-cleanup.sql` |
| Manual / external-scheduler entry point | `scripts/rate-limit-cleanup.ts` |
| Retention / age constant | `CLEANUP_AGE_MS` in `src/lib/rate-limit.ts` |

The delete is:

```sql
DELETE FROM "RateLimit" WHERE "windowStart" < now() - interval '1 day';
```

Rows are one per `(scope, user)`, not one per request (`consume()` reuses the key
and only resets `count`), so the table is bounded by distinct users × 8 scopes.
Hourly is therefore more than enough; daily with a 2-day predicate is also fine
if you prefer fewer runs.

### Deploy

Requires the [Neon CLI](https://neon.com/docs/cli) (v4.21+) and project access.
Neon Functions run in `aws-us-east-2`, `aws-us-east-1`, `aws-eu-central-1`, or
`aws-ap-southeast-1` — this project's database is in `eu-central-1`.

```bash
npm i -g neon@latest
neon link                  # writes .neon and pulls branch env into .env
neon config plan           # review: this also reconciles the `auth: true` policy
neon deploy                # provisions the function + trigger
neon logs query --source function   # confirm the first run
```

`neon deploy` applies to the linked branch. Function Triggers are branch-scoped;
triggers inherited by a child branch start **disabled**, so run `neon deploy`
against the branch that should execute the GC (normally the primary/production
branch). `DATABASE_URL` is injected into the function automatically.

### Verify

1. On a scratch/dev branch, insert a stale row:

   ```sql
   INSERT INTO "RateLimit" ("key", "count", "windowStart")
   VALUES ('ops:stale', 1, now() - interval '2 days');
   ```

2. Run the job by hand without waiting for the clock:

   ```bash
   npx tsx scripts/rate-limit-cleanup.ts          # dry run: reports the count
   npx tsx scripts/rate-limit-cleanup.ts --apply  # deletes
   ```

   Or invoke the deployed function locally with `neon dev` and a POST that
   carries an `X-Neon-Trigger-Invocation-Id` header (the handler rejects calls
   without it).

3. Confirm the stale row is gone and the log line reports the deleted count.
4. Over a few days, `SELECT count(*) FROM "RateLimit"` should stay flat.

### Fallbacks (if you don't want a Neon Function)

- **Vercel Cron:** add a `CRON_SECRET`-guarded route that calls
  `deleteStaleRateLimits(...)`, plus a `crons` entry in `vercel.json`. Note the
  Hobby plan allows **daily** crons only — widen the predicate to
  `interval '2 days'` if you go that route.
- **GitHub Actions:** run
  `psql "$DATABASE_URL_UNPOOLED" -f scripts/sql/rate-limit-cleanup.sql` on an
  hourly schedule from a repository secret.
- **Don't use `pg_cron`** unless the compute is always on: it only runs while
  Postgres is active, and this app relies on scale-to-zero.
