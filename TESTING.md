# Testing

This repository uses one runner per layer:

- **Vitest** for unit, component, database-integration, and HTTP-contract tests.
- **Playwright** for every browser/E2E and browser-level accessibility check.

Cypress, Jest, and a second browser runner are intentionally not used.

The working checklist that defines the full suite lives in
[`testing_plan.md`](./testing_plan.md). This file explains how to run what
exists today and how to add tests safely.

---

## Layers

| Layer | Command | Environment | Database |
|---|---|---|---|
| Static | `npm run verify` | `tsc`, ESLint, `next build` | No |
| Unit | `npm test` | Vitest `node` | No |
| Component | `npm test` | Vitest `jsdom` + Testing Library | No |
| DB integration | `npm run test:db` | Vitest `node`, serial | Ephemeral Neon branch |
| HTTP contract | `npm run test:http` | Vitest `node` + built app | Ephemeral Neon branch |
| E2E | `npm run test:e2e` | Playwright, production build | Ephemeral Neon branch |

`npm test` is always safe: it makes no network calls and never reads a
database. Everything else is gated (see [Safety rules](#safety-rules)).

---

## Quick start

```bash
npm install
npm test                     # unit + component, no setup required
npm run typecheck
```

For anything that touches a database:

```bash
# One-time: create the data-free base branch (needs a Neon API key).
npm run db:test:base

# Each test session / CI job:
npm run db:test:up           # create branch, write .env.test, migrate
npm run test:db              # DB integration suite
npm run test:e2e             # Playwright against a production build
npm run db:test:down         # delete the branch, remove .env.test
```

`NEON_API_KEY` and `NEON_PROJECT_ID` are read from the environment or from
`.env` (the script loads it; process env wins). The key must be a real
`napi_…` key, not an auth URL.

`db:test:up` refuses to overwrite an existing `.env.test` unless you pass
`--force` (`npm run db:test:up -- --force`).

---

## Test database lifecycle

Database-backed tests never point at `.env`. They use `.env.test`, which is
generated for a disposable Neon branch. There are two levels:

1. **`test-base` — the data-free base.** Created once with
   `npm run db:test:base`. It contains the application schema but **no rows and
   no auth identities**, and is never used by tests directly.
2. **Ephemeral branches — one per run.** `db:test:up` creates a branch from
   `test-base`, provisions a branch-scoped Neon Auth service, allows the
   `localhost` origin, writes `.env.test`, and applies migrations.

Why the extra scrub: Neon refuses every schema-only init source (`schema-only`,
`parent-schema`) while the project has Neon Auth's legacy web access roles
(`anonymous`, `authenticated`), and removing those roles from production is not
acceptable. `db:test:base` therefore falls back to a **one-time copy-on-write
branch** and immediately makes it data-free: every `public` table except
`_prisma_migrations` is truncated, and `neon_auth` identity tables
(`user`, `session`, `account`, `member`, `invitation`, `organization`,
`verification`) are emptied. Auth configuration (`project_config`, `jwks`) is
kept so branch auth keeps working. The script then asserts the branch is empty
and deletes it if anything fails, so no copied row survives an aborted run.

Because the branch has tables but no `_prisma_migrations` rows,
`db:test:base` marks every existing migration as already applied. Children
inherit that baseline, so `prisma migrate deploy` only applies *new*
migrations. Each ephemeral branch gets its own auth service from the API; if
the inherited `neon_auth` schema blocks provisioning, that disposable branch
drops the schema and retries once.

`test-base` is a normal child branch, so it can be recreated with
`npm run db:test:base -- --force` (delete first, then create) after production
schema changes; it starts from the current `production` schema each time.

Steps for one run:

1. `db:test:up` resolves `NEON_TEST_PARENT_BRANCH` (default `test-base`) and
   refuses to branch from the project's default branch.
2. It waits for the new branch to reach `ready`.
3. It enables Neon Auth for that branch (`POST …/auth`, `better_auth`) unless the
   branch already has it, then reads the branch's own `base_url` / `jwks_url`.
4. It enables `allow_localhost` on that branch so browser auth calls from
   Playwright are accepted.
5. Pooled and direct connection URIs, the branch auth URL, `TEST_BASE_URL`, and
   a random per-run `NEON_AUTH_COOKIE_SECRET` are written to `.env.test`.
6. `prisma migrate deploy` runs against the direct URL. Migrations are applied
   with Prisma, never with `prisma db push`.
7. `prisma migrate status` must be clean, and the branch must be data-free
   (all `public` tables and `neon_auth."user"` empty) or setup fails.
8. Application code and tests use the pooled URL, so advisory locks and
   transaction behaviour are exercised through PgBouncer.
9. If setup fails halfway, the script deletes the branch and removes
   `.env.test` before exiting.
10. `npm run db:test:down` deletes the branch and removes `.env.test`.
    `npm run db:test:status` prints the current target (hosts only).

## Known issues and gotchas

### HTTP test app lifecycle

`npm run test:http` builds and starts the production app itself: Vitest's
global setup (`tests/http/global-setup.ts`) runs `next build` once, starts
`next start` on `TEST_BASE_URL`, creates a small roster of auth users, and
tears the server down after the run. If something is already listening on the
port (for example a CI-managed `next start`), the helper reuses it.

Set `HTTP_TEST_SKIP_BUILD=1` to reuse an existing `.next` build. Set
`HTTP_TEST_VERBOSE=1` to see the app's stdout/stderr.

The HTTP project runs files serially (`fileParallelism: false`): it truncates
domain tables between tests and must not race other files.

### Auth rate limits in tests

Better Auth rate-limits `/sign-up` and `/sign-in` to 3 requests per 10 seconds.
`global-setup.ts` therefore creates four reusable users once (organizer,
holder, outsider, other) and stores their session cookies; tests adopt those
cookies instead of signing in again. The helpers retry politely (honouring
`X-Retry-After`) when a test does hit the limit, so sign-up/sign-in coverage
still runs against the real endpoints.

### Note: private event detail pages return 200, not 404

Next 16 streams the event page, so `notFound()` renders after the response
headers are sent. Outsiders receive status `200` with the generic not-found
content and `<title>Event not found</title>`; the private event's title,
description, and metadata are never included. API routes (`/calendar`,
`/attendees`) still return `404`/`401` and do not disclose existence.

### Auth origin rule

Better Auth validates the browser `Origin` on state-changing auth calls
(sign-up, sign-in), and the Next.js auth proxy forwards that origin upstream.
Neon's `allow_localhost` setting trusts `localhost` but **not** `127.0.0.1`, so
`TEST_BASE_URL` must use the hostname form:

```dotenv
TEST_BASE_URL="http://localhost:3100"
```

Using `http://127.0.0.1:3100` produces `403 Invalid origin` on sign-up. If you
change the host or port, the branch must trust that origin as well.

Environment variables for the lifecycle script:

| Variable | Required | Purpose |
|---|---|---|
| `NEON_API_KEY` | yes | `napi_…` key with branch create/delete permission. |
| `NEON_PROJECT_ID` | yes | Project id, or `projectId` in a `.neon` file. |
| `NEON_TEST_BASE_BRANCH` | no | Defaults to `test-base` (`db:test:base`). |
| `NEON_TEST_PARENT_BRANCH` | no | Defaults to `test-base`; never the default branch. |
| `NEON_TEST_DATABASE` | no | Defaults to `neondb`. |
| `NEON_TEST_ROLE` | no | Defaults to `neondb_owner`. |
| `NEON_API_BASE` | no | Override for mocks/tests. |

### `.env.test` contents

`db:test:up` writes, and `.env.test.example` documents:

```dotenv
TEST_DB_ALLOW=1
DATABASE_URL="postgresql://…@ep-xxx-pooler.…/neondb?sslmode=require"
DATABASE_URL_UNPOOLED="postgresql://…@ep-xxx.…/neondb?sslmode=require"
APP_TIME_ZONE="Europe/Berlin"
NEON_AUTH_BASE_URL="https://ep-xxx.neonauth.…/neondb/auth"
NEON_AUTH_JWKS_URL="https://ep-xxx.neonauth.…/neondb/auth/.well-known/jwks.json"
NEON_AUTH_COOKIE_SECRET="…per-run random…"
TEST_BASE_URL="http://localhost:3100"
TEST_DB_PROJECT_ID=…
TEST_DB_BRANCH_ID=…
TEST_DB_BRANCH_NAME=…
TEST_DB_AUTH_HOST=…
```

The auth variables are not optional decoration: `next build` and `next start`
load `.env` for any missing variable. The HTTP global setup loads `.env.test`
and passes those values to the `next build`/`next start` child processes, so
the app always talks to the branch auth service. If you start the app yourself,
export the `.env.test` values first. Never leave `.env` pointing at test
credentials after the test session, and never commit `.env.test`.

`.env.test` contains credentials and is gitignored. Never commit it, paste it
into an issue, or print it.

### Reusing a long-lived test branch

If you cannot create branches (for example a fork without API access), copy
`.env.test.example` to `.env.test` and fill in a dedicated non-production
branch. You are then responsible for migrations and cleanup. The guard still
refuses production hosts.

---

## Safety rules

These are enforced by `tests/support/env.ts`, which runs before any DB test
file is imported:

- `TEST_DB_ALLOW=1` is required. Anything else aborts the run.
- `NODE_ENV=production` aborts the run.
- Both URLs must be present and parse.
- `DATABASE_URL` must be a Neon pooled (`-pooler`) host.
- Pooled and direct hosts must resolve to the same endpoint/branch.
- Any host matching the app database in `.env` (compared by host and endpoint)
  aborts the run.
- `NEON_AUTH_BASE_URL`, when set, must not resolve to the app auth host in
  `.env`. A test run must never create real users in production auth.
- An optional `TEST_DB_HOST_ALLOWLIST` (comma-separated suffixes) can pin the
  allowed domain.
- Only hosts are printed, never credentials.

Additional rules:

- **Never run destructive tests against production.** Not "read-only", not
  "just one query". The guard is the last line of defence, not a licence.
- Do not add `prisma db push` to scripts, docs, or CI. Use migrations only.
- DB tests truncate only the app's domain tables (`Event`, `RSVP`, `Comment`,
  `Notification`, `RateLimit`). `neon_auth` is never truncated.
- `db:test:up` fails if the new branch is not data-free; it never runs tests on
  a branch that inherited rows.
- E2E teardown must delete only rows the run created, or the whole branch.
- CI must delete the branch in a `finally`/`always()` step, including on
  failure.
- Credentials must never appear in logs or uploaded artifacts.

`npm run test:db` without a prepared `.env.test` fails loudly on purpose.
`npm run test:http` requires `.env.test`; it builds and starts the app itself
on `TEST_BASE_URL` (port 3100 by default), then stops it. An already-running
server on that port is reused.
Playwright skips its specs and does not start the app when `.env.test` is
missing or `TEST_DB_ALLOW` is not `1`. If `.env.test` *is* present but lacks a
branch-scoped `NEON_AUTH_BASE_URL`, it fails instead of silently using
production auth.

---

## Commands

| Command | What it does |
|---|---|
| `npm test` | Unit + component projects. Fast, no DB, no network. |
| `npm run test:watch` | Watch mode for unit + component. |
| `npm run test:db` | DB integration project, serial, ephemeral branch. |
| `npm run test:http` | HTTP contract project: builds + starts the app, 4 specs. |
| `npm run test:e2e` | Playwright projects: desktop Chromium + Pixel 7. |
| `npm run test:all` | Unit + component, DB, HTTP, E2E. |
| `npm run test:ci` | Unit + component, then DB. The CI-safe subset. |
| `npm run db:test:base` | One-time: create/baseline the data-free `test-base`. |
| `npm run db:test:up` | Create branch, provision auth, write `.env.test`, `migrate deploy`. |
| `npm run db:test:down` | Delete branch and remove `.env.test`. |
| `npm run db:test:status` | Print the current test target (hosts only). |
| `npm run verify` | Typecheck + scoped lint + probes + production build. |
| `npm run verify:full` | `verify` plus `test:all`. |
| `npm run verify:db` | Alias for `test:db`. |

The legacy probe scripts (`scripts/timezone-check.ts`,
`scripts/search-check.ts`, `scripts/rate-limit-check.ts`,
`scripts/rsvp-concurrency.ts`) are retained until parity is proven. Their
invariants are now asserted by Vitest; `verify` still runs the two read-only
probes. `verify:db` no longer runs the destructive probes directly — it runs
the DB suite, which uses the safety guard.

Playwright installs browsers with `npx playwright install chromium`. Reports
go to `playwright-report/`, artifacts to `test-results/`; both are gitignored.

---

## Writing a regression test

Pick the lowest layer that can observe the failure:

1. **Pure logic** (dates, parsing, URLs, escaping) → `tests/unit/`.
2. **Client state machine** (optimistic UI, pending, errors) →
   `tests/components/` with Testing Library. Mock server actions and
   `next/navigation`; do not render async Server Components.
3. **Data invariant, constraint, concurrency, authorization rule** →
   `tests/db/`. Build fixtures with `tests/support/factories.ts`, call the
   request-free cores (`*Core` functions) rather than server actions.
4. **Route handler contract** (status, headers, CSV/ICS bytes) →
   `tests/http/` with the built app started by the HTTP global setup.
5. **User-visible journey** → `tests/e2e/` with Playwright and a real user.

Guidelines:

- Name the test after the behaviour that broke, not the function under test.
- Reproduce the bug first and watch the test fail for the right reason.
- Prefer deterministic fixtures: relative dates from the factories, injected
  `now`, fake timers via `vi.setSystemTime` for unit tests.
- Never sleep to advance a rate-limit window; rewrite `windowStart` directly.
- Every fixture title/user id carries the `RUN_ID` prefix so leftovers are
  identifiable.
- Use `resetDomainTables()` in `beforeEach` for DB tests.
- Do not assert on log output unless the log is the contract.
- Keep one assertion rationale per test; split unrelated expectations.

### Production seams for tests

These are deliberate and must preserve runtime behaviour:

| Seam | Location | Why |
|---|---|---|
| `*Core` query functions | `src/lib/events.ts` | Queries without `connection()` so DB tests can call them directly. Request wrappers keep `connection()`. |
| Invite link cores | `src/lib/invite.ts` | Idempotent claim, regenerate, revoke, accept without auth/redirects. |
| Notification fan-out | `src/lib/event-notifications.ts` | Recipient selection (opt-out, organizer exclusion, 20-recipient cap) testable without a session. |
| Cleanup handler factory | `functions/rate-limit-cleanup.ts` | Trigger-header guard and failure branches testable without a pool. |

---

## Manual-only checks

Some things cannot be automated in this setup and stay manual:

- The full Google OAuth consent flow (the automated check stops at the
  provider redirect).
- Real email delivery and deliverability (sign-up verification, password
  reset).
- Production/preview deployment smoke tests, if the policy allows them.
- Whether sign-up on a fresh branch requires email verification (the branch is
  provisioned with provider defaults; authenticated E2E still needs a confirmed
  policy).
- Browser matrix beyond Chromium + one mobile viewport (Firefox/WebKit only if
  cross-browser support becomes a requirement).
- Recovery from a real database outage (the error boundary can be exercised
  with fault injection, but a provider outage is production-only).

---

## Known gaps (after Phase 4)

- Playwright E2E contains only a smoke spec. Authenticated journeys need the
  Neon Auth test-user helpers (the HTTP roster in
  `tests/http/helpers/roster.ts` is a starting point); branch auth provisioning
  itself is wired into `db:test:up`.
- HTTP contract gaps: the origin-less ICS URL fallback is covered by unit
  tests only (an HTTP request always has an origin); CSV stream failure needs
  fault injection against the separate app process (client abort is covered);
  and `csvCell` neutralizes `= + - @` but not a leading tab/CR (quoted, but not
  apostrophe-prefixed).
- CI is not wired yet. The intended job split is in `testing_plan.md`.
- Optional tooling (`fast-check`, `ical.js`, `csv-parse`) is not installed.
- Runtime validation of `test-base` and the ephemeral branch still requires a
  valid `NEON_API_KEY` and `NEON_PROJECT_ID`.
