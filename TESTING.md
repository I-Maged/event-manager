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
| HTTP contract | `npm run test:http` | Vitest `node` + running app | Ephemeral Neon branch |
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
# One-time per shell/CI job. Requires a Neon API key.
export NEON_API_KEY=...            # PowerShell: $env:NEON_API_KEY = "..."
export NEON_PROJECT_ID=...
export NEON_TEST_PARENT_BRANCH=test-base

npm run db:test:up           # create branch, write .env.test, migrate
npm run test:db              # DB integration suite
npm run test:e2e             # Playwright against a production build
npm run db:test:down         # delete the branch, remove .env.test
```

`db:test:up` refuses to overwrite an existing `.env.test` unless you pass
`--force` (`npm run db:test:up -- --force`).

---

## Test database lifecycle

Database-backed tests never point at `.env`. They use `.env.test`, which is
generated for a disposable Neon branch.

1. `npm run db:test:up` calls the Neon REST API (no Neon CLI dependency) and
   creates a branch from `NEON_TEST_PARENT_BRANCH`.
2. The parent must be a **schema-only** branch such as `test-base`. Never point
   it at production: a copy-on-write branch starts with all of production's
   rows and PII.
3. The branch gets its own read/write endpoint. Pooled and direct connection
   URIs are written to `.env.test` as `DATABASE_URL` and
   `DATABASE_URL_UNPOOLED`.
4. `prisma migrate deploy` runs against the direct URL. Migrations are applied
   with Prisma, never with `prisma db push`.
5. Application code and tests use the pooled URL, so advisory locks and
   transaction behaviour are exercised through PgBouncer.
6. If setup fails halfway, the script deletes the branch and removes
   `.env.test` before exiting.
7. `npm run db:test:down` deletes the branch and removes `.env.test`.
   `npm run db:test:status` prints the current target (hosts only).

Environment variables for the lifecycle script:

| Variable | Required | Purpose |
|---|---|---|
| `NEON_API_KEY` | yes | Branch create/delete permission. |
| `NEON_PROJECT_ID` | yes | Project id, or `projectId` in a `.neon` file. |
| `NEON_TEST_PARENT_BRANCH` | yes | Schema-only parent branch id (`br-…`) or name. |
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
TEST_DB_PROJECT_ID=…
TEST_DB_BRANCH_ID=…
TEST_DB_BRANCH_NAME=…
```

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
- An optional `TEST_DB_HOST_ALLOWLIST` (comma-separated suffixes) can pin the
  allowed domain.
- Only hosts are printed, never credentials.

Additional rules:

- **Never run destructive tests against production.** Not "read-only", not
  "just one query". The guard is the last line of defence, not a licence.
- Do not add `prisma db push` to scripts, docs, or CI. Use migrations only.
- DB tests truncate only the app's domain tables (`Event`, `RSVP`, `Comment`,
  `Notification`, `RateLimit`). `neon_auth` is never truncated.
- E2E teardown must delete only rows the run created, or the whole branch.
- CI must delete the branch in a `finally`/`always()` step, including on
  failure.
- Credentials must never appear in logs or uploaded artifacts.

`npm run test:db` without a prepared `.env.test` fails loudly on purpose.
`npm run test:http` currently exits 0 with "No test files found" (Phase 4).
Playwright skips its specs and does not start the app when `.env.test` is
missing or `TEST_DB_ALLOW` is not `1`.

---

## Commands

| Command | What it does |
|---|---|
| `npm test` | Unit + component projects. Fast, no DB, no network. |
| `npm run test:watch` | Watch mode for unit + component. |
| `npm run test:db` | DB integration project, serial, ephemeral branch. |
| `npm run test:http` | HTTP contract project (no tests yet). |
| `npm run test:e2e` | Playwright projects: desktop Chromium + Pixel 7. |
| `npm run test:all` | Unit + component, DB, HTTP, E2E. |
| `npm run test:ci` | Unit + component, then DB. The CI-safe subset. |
| `npm run db:test:up` | Create branch, write `.env.test`, `migrate deploy`. |
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
   `tests/http/` once Phase 4 lands.
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
- Confirm the Neon Auth behaviour on an ephemeral branch: whether users are
  copied from the parent and whether test users need email verification.
- Browser matrix beyond Chromium + one mobile viewport (Firefox/WebKit only if
  cross-browser support becomes a requirement).
- Recovery from a real database outage (the error boundary can be exercised
  with fault injection, but a provider outage is production-only).

---

## Known gaps (Phase 0 state)

- The `http` project has no tests; Phase 4 adds CSV, ICS, auth-route, and
  header contracts.
- The `components` project contains only a harness smoke test; Phase 2 adds
  the real client state-machine coverage.
- E2E contains only a smoke spec. Authenticated journeys need the Neon Auth
  test-user helpers and a confirmed verification policy.
- CI is not wired yet. The intended job split is in `testing_plan.md`.
- Optional tooling (`fast-check`, `ical.js`, `csv-parse`) is not installed.
- Runtime validation of branch creation/migration requires `NEON_API_KEY`,
  `NEON_PROJECT_ID`, and a schema-only `test-base` branch.
