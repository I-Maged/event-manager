# Phase 6 — Hardening and Operations Implementation Plan

Status (2026-10-31): **S0, S1, S2, S3, S4, and S5 implemented; Finding F1 fixed.** S6 remains. Fault
injection (6 tests), script CLIs (5), `when` day boundaries (4), the CSV stream
extraction + tests (5 unit), the S0 baseline, and the render-safe session fix
(8 tests) are in. Suites: `npm test` = 33 files / 225, `test:db` = 11 files /
142, `test:http` = 4 files / 32, `tsc --noEmit` clean. A repeated E2E run is
the final F1 check. S3–S6 remain. Live ephemeral branch:
`test-2026-10-30T10-20-43-462Z-86iz99` (`br-dry-hall-b2hqn50x`).

Source of truth for Phase 6. Work through the slices in order; each slice ends by
flipping the `testing_plan.md` checkboxes it closes. Nothing here changes
application behaviour except the one deliberate, inert test seam in §5.3 (CSV
stream extraction) and the retirement of obsolete probe scripts (§6.3).

---

## 0. Scope

Phase 6 closes four kinds of work:

1. **Fault injection (6.1)** — prove every best-effort path degrades instead of
   cascading: limiter fail-open, fan-out failures that must not roll back the
   parent write, and check-in/reminder paths that must return an error value
   instead of throwing.
2. **Gaps deferred from earlier phases** — 3.8 script/job tests, 3.9 `when`
   filter app-zone day boundaries, 4.2 CSV stream failure, 3.4 PR/nightly
   concurrency profiles.
3. **Deployment safety and CI (6.3 + CI checklist)** — migration drift check,
   branch cleanup that runs on failure, and a real pipeline with the
   PR/nightly split, coverage reporting, and artifacts.
4. **Suite hygiene** — coverage thresholds, flake quarantine, retiring the
   legacy probe scripts, and documentation that matches the result.

Explicitly out of scope: new product features, Firefox/WebKit, real email
delivery, and the manual Google consent flow (they stay manual, see
`TESTING.md` → *Manual-only checks*).

---

## 1. Decisions

| # | Topic | Decision | Rationale |
|---|---|---|---|
| 1 | CI provider | GitHub Actions (`.github/workflows/ci.yml`) | Only provider consistent with the repo's PR/nightly split; no CI files exist yet. **Needs secret availability (§13.1).** |
| 2 | Branch per job | Every DB-backed CI job runs `db:test:up` in its own job and `db:test:down` in `if: always()` | Already the documented rule: HTTP/E2E never share a branch. Parallel jobs = independent branches, no cross-job truncation races. |
| 3 | Fault injection style | DB-level tests against the request-free cores with `vi.spyOn(prisma.<model>, ...)` rejection, wrapped in a shared helper; reuse the two `catch` paths already tested | The cores are the sanctioned seams (`TESTING.md` → *Production seams*). Server actions add auth/redirect only, which the DB and E2E layers already cover. |
| 4 | Script/job tests (3.8) | Spawn the real CLI with `tsx` under `.env.test`, assert stdout + rows | The contract is the flag wiring and exit code, not a function; a spawn test catches a wrong `--apply` mapping that a core test would not. No source refactor. |
| 5 | CSV stream failure (4.2) | Extract the stream into `src/lib/attendee-csv.ts` with an injected page fetcher; assert the error path there and keep HTTP for status/headers/abort | A stream that already sent 200 cannot change status. The contract is "`controller.error`, one log line, no silent truncated success" — that is the stream builder, not HTTP. |
| 6 | Coverage | `@vitest/coverage-v8`, thresholds on `src/lib` only; report-only for the first two runs, then gate | Prisma-generated code and pages are excluded; DB-layer coverage needs the branch, so the gate lives in the DB job. |
| 7 | Performance | Separate `perf` Vitest project, nightly only, budgets calibrated from one measured baseline (gate = 3× measured p95) | The plan calls 6.2 optional P2; Neon latency makes fixed ceilings flaky. |
| 8 | Flake policy | Zero `waitForTimeout` in specs (guarded by a unit test), `@quarantine` tag documented and empty at close | Cheapest durable anti-flake measure; the tag gives a real escape hatch later. |
| 9 | Legacy probes | Retire `rsvp-concurrency.ts`, `rate-limit-check.ts`, `search-check.ts`, `timezone-check.ts` and their `.log` artifacts | Parity is proven (mapping table in §6.3); keeping them means `verify` runs logic no one trusts. |
| 10 | `data-pending`, callback URLs | Nothing left to do | Closed in Phase 5. |

---

## 2. Gap audit — what already exists

Do not re-test these; mark the checkbox with a pointer instead.

| Phase 6 item | Existing evidence |
|---|---|
| Rate limiter fails open on DB error | `tests/db/rate-limit.test.ts` → *fail-open on DB error* (hashed id, missing table). Two of three cases already assert exactly this. |
| Reminder creation never throws into render | `tests/db/queries.test.ts` → `ensureDueReminders` *never throws on DB failure* (3.9). |
| Notification write failure does not fail the parent action (generic) | `tests/db/notifications.test.ts` → *write failure does not fail the parent action* (EVENT_UPDATED only). |
| `CHECK` constraints, cascades, indexes | `tests/db/constraints.test.ts` (3.10). |
| `prisma db push` forbidden | `tests/db/constraints.test.ts` scans `package.json` + docs. |
| Migration apply/status on a fresh branch | `scripts/test-db.ts` `up` (steps 6–7) and `tests/db/constraints.test.ts` first test. |
| Invite/check-in atomicity, rate-limit messages, past-date RSVP, wall clock, pagination/CSV/search/HSTS traceability rows | Covered by Phase 3/4/5; Phase 6 only flips the boxes with pointers. |
| 6.4 documentation | All four boxes checked; only edits are needed for the new layers (§6.4). |

Everything else in 6.1/6.2/6.3, plus 3.8 (6 items), 3.9 (1), 4.2 (1), 3.4 (1),
the CI checklist (12), the coverage bullets (3) and three DoD lines are open.

---

## 3. Slice S0 — Baseline and branch hygiene (0.25 day) — done 2026-10-30

1. `npm run db:test:down && npm run db:test:up -- --force` for a clean branch —
   done: deleted `br-withered-bar-b2s04xlj`, created
   `test-2026-10-30T10-20-43-462Z-86iz99` (`br-dry-hall-b2hqn50x`, endpoint
   `ep-floral-surf-b2p2w8q5`). 13 migrations applied, `migrate status` clean,
   which also proves `NEON_API_KEY` / `NEON_PROJECT_ID` work.
2. Baseline recorded (below).
3. `--repeat-each=2` run recorded (flake list below); `waitForTimeout`
   inventory is **12** call sites, not the 10 first assumed — `comments` ×4,
   `notifications` ×2, `rsvp` ×2, `dashboard`, `external`, `security`,
   `wishlist` ×1 each. S3 must remove all 12 before the hygiene guard goes in.
4. Neon credentials confirmed by step 1 (branch create + auth provisioning).

### S0 recorded baseline (fresh branch, this machine, Node 22)

| Layer | Command | Result | Duration |
|---|---|---|---|
| Unit + component | `npm test` | 31 files / 217 tests | 29.0 s |
| DB integration | `npm run test:db` | 11 files / 142 tests | 191.4 s |
| HTTP contract | `npm run test:http` | 4 files / 32 tests (includes a fresh `next build` + server) | 50.8 s |
| E2E ×2 | `E2E_SKIP_BUILD=1 npm run test:e2e -- --repeat-each=2` | 202 passed / 63 failed / 4 skipped (exit 1) | 28.2 min |

The DB layer dominates wall time (Neon round trips, ~1.35 s/test); the CI time
budget should assume DB + HTTP + E2E never run in the same job. `test:http`
reuses an existing `.next` only when `HTTP_TEST_SKIP_BUILD=1` is set, so a real
build is included above.

### S0 flake list (`--repeat-each=2`, one process, one branch)

Result: **202 passed, 63 failed, 4 skipped, 28.2 min, exit 1.** This is not a
flake list — every failure has one root cause and appears only in repetition 2.

- Repetition 1 (tests 1–127) is fully green. Repetition 2 starts at 128; tests
  128–162 (a11y, auth, browse) pass, then failures begin at 163 (calendar) and
  continue to the end.
- All 63 failure artifacts show the same page: the app error boundary
  ("Something went wrong", Reference `1420334223`).
- `test-results/server.log` contains exactly one error type, 116 times:
  `Cookies can only be modified in a Server Action or Route Handler` on GET
  renders of `/events/[id]` (69) and `/auth/sign-in?next=…` (43).
- Failing files: notifications 10, events 10, rsvp 9, dashboard 9, wishlist 8,
  invites 7, comments 7, calendar 2, security 1.
- Teardown still worked: all five domain tables were `0` afterwards (checked
  directly with a branch-scoped query, since `global-teardown.ts` swallows
  errors). No server was left on port 3200.
- Log kept at `test-results/s0-e2e-repeat.log` (gitignored).

### Finding F1 — session refresh throws during an RSC render (product bug)

No test-level flake was found. The Neon Auth SDK refreshes its session-data
cookie inside `auth.getSession()` during a React Server Component render; Next
16 turns that cookie write into a hard error (digest `1420334223`), so the page
renders the error boundary and the assertion or 30 s timeout fails. It appears
~11 minutes into the run, when the cached session data created by
`tests/e2e/auth.setup.ts` expires — every signed-in render after that point
fails.

Consequences:

- A signed-in user whose session cache expires gets the error boundary on the
  next protected render. This is user-facing, not a harness artifact.
- `--repeat-each=2` cannot be a flake detector or nightly gate until it is
  fixed: the second pass will always collapse. The single pass stays the gate.

### F1 fix (2026-10-30)

Auth is now split by what the caller may do with cookies:

- `authHandler` (Next adapter) keeps `handler()` and `middleware()`, where
  cookie writes are legal.
- `auth` is a `createAuthServer(...)` instance whose request context wraps
  `cookieStore.set` in `createSafeCookieWriter`. A render-time write is skipped
  and logged (`[neon-auth] skipped session cookie refresh during render`); the
  session data from the same call is still returned. Every non-render cookie
  error is still thrown.

Files: `src/lib/auth/cookie-write.ts` (new), `src/lib/auth/server.ts`,
`src/app/api/auth/[...path]/route.ts`, `src/proxy.ts`.

Regression tests:

- `tests/unit/auth-session-render.test.ts` drives the real SDK: a stubbed
  `/get-session` rotates the token, the cookie store throws Next's render error.
  With the guard the call resolves and reports both skipped writes (session
  token + minted cache); without it the same call rejects with the original
  error — the exact pre-fix failure.
- `tests/unit/auth-cookie-write.test.ts` pins the writer contract (skip only
  the render error, pass everything else through, rethrow real failures).
- `tests/e2e/auth.spec.ts` → *an expired session cache still renders signed-in
  pages*: drop the `session_data` cookie, open `/account`, assert the account
  row and no error boundary.

The upstream trigger for the refresh was not isolated separately (it needs a
~15-minute-old session and a rotating response). The guard is correct for every
such write, so it does not depend on identifying that trigger.

---

## 4. Slice S1 — Fault injection (1 day) — done 2026-10-30

### 4.1 Helper

`tests/support/faults.ts`:

- `failModel(model, method, error?)` → installs a `vi.spyOn(...).mockRejectedValue`
  on the matching `prisma` model delegate and returns a `restore()` function.
- `captureConsoleError()` → collects `console.error` calls for the one test that
  asserts a log line, and always restores.
- Both are `try/finally` friendly so a failing assertion cannot leak a stub into
  the next test in the serial DB project.

### 4.2 New tests — `tests/db/fault-injection.test.ts`

| # | Test (behaviour, not function) | Setup → assertion |
|---|---|---|
| 1 | Promotion notification failure does not roll back the promotion | cap 1, A `GOING`, B `WAITLISTED`; `cancelRsvpCore(A)` (commits promotion), then `notifyPromotions` with `notification.createMany` rejecting. Assert B `GOING` + `promotedAt` set, `notifyPromotions` resolves, 0 notifications. |
| 2 | Event-update notification failure does not undo the edit | `updateEventCore` (title change) then `notifyEventUpdated` with rejected write. Assert stored title is the new one, fan-out returns 0. |
| 3 | Cancellation notification failure does not fail the cancel | recipients captured, `event.delete`, then `notifyEventCancelled` with rejected write. Assert event gone, returns 0, no throw. |
| 4 | Comment notification failure does not fail the comment | create comment row, then `notifyNewComment` with rejected write. Assert comment still present, returns 0. |
| 5 | Check-in returns `{ok:false}` instead of throwing on DB failure | reject `prisma.rSVP.updateMany` (and `findUnique` for the second case). Assert `checkInAttendeeCore` / `undoCheckInCore` resolve to `{ok:false, error}` and log once. |
| 6 | A limiter outage does not block the write it guards | reject `prisma.$queryRaw`; `enforceRateLimit('comment', id)` resolves `null`; the comment row that follows is created. Mirrors the action's ordering without a session. |

Then flip 6.1 boxes:

- *Rate limiter fails open* → existing `rate-limit.test.ts` (plus #6).
- *Reminder creation never throws* → existing `queries.test.ts`.
- The other five → the table above.

### 4.3 Explicit non-goal

The server actions themselves (`setRsvp`, `deleteEvent`, `addComment`) are not
driven from tests: they call `auth.getSession()` + `redirect()`. Their ordering
(write commits before best-effort fan-out) is visible in code and exercised
end-to-end in Phase 5. Record this as a note under 6.1 so the checkbox is not
mistaken for action-level coverage.

Acceptance: `npm run test:db` green; each new test fails if the corresponding
`catch` in the core is removed (spot-check two of them manually).

---

## 5. Slice S2 — Deferred gaps (1 day) — done 2026-10-30

### 5.1 3.8 — scripts and scheduled job

- `tests/db/rate-limit.test.ts`: add one test asserting the handler logs on a
  failed cleanup (rejected query) and returns `{ok:false}`/500 — the only
  missing half of *"It returns 500 and logs on DB failure."*
- New `tests/db/scripts.test.ts` (serial): spawn `npx tsx <script>` with
  `spawnSync`, `shell: true`, and an env built as
  `{ ...process.env, DATABASE_URL, DATABASE_URL_UNPOOLED, APP_TIME_ZONE }`
  after `assertTestDatabaseSafety()` in the parent. `.env` is loaded by the
  script's `dotenv/config` but never overrides explicit values, and the
  script's first output line is the resolved host — assert the target host
  contains the test endpoint.

| Test | Command | Assertion |
|---|---|---|
| cleanup dry run reports without deleting | `rate-limit-cleanup.ts` | exit 0, stdout has the stale count + "dry run"; both rows still present |
| cleanup `--apply` deletes and reports | `rate-limit-cleanup.ts --apply` | exit 0, stdout has "Deleted 1"; stale gone, fresh kept |
| backfill dry run reports null-zone rows | `backfill-time-zone.ts` | exit 0, stdout has the count; row still `timeZone = null` |
| backfill `--apply --allow-writes` stamps only null rows | same + flags | exit 0, stdout has "Backfilled"; null row stamped `Europe/Berlin`, non-null row unchanged |
| backfill rejects an invalid zone | `APP_TIME_ZONE=Not/AZone`, `--apply --allow-writes` | exit 1, stderr names the zone, no row changed |

### 5.2 3.9 — `when` filter day boundaries

Extend `tests/db/queries.test.ts` with a `when filters` describe using the
injected `now` of `getPublicEventsPageCore` (no fake timers) and
`APP_TIME_ZONE=Europe/Berlin`:

- `now = 2026-03-29T21:30:00Z` (23:30 local, spring-forward day). `today`
  includes an event at `21:45Z` and excludes one at `22:30Z` (00:30 local next
  day) — proves the upper bound is local midnight, not `now + 24h`.
- For each of `week` / `month`, seed the pair `boundary − 1 min` (included) and
  `boundary + 1 min` (excluded), where `boundary = addDaysInZone(now, 7|30)` is
  computed in the test. Never hardcode a UTC string: the assertion is about the
  local-midnight rule, not about one timezone offset.
- `any` excludes past events; the lower bound of every filter is `now`.
- A DST 25-hour day (2026-10-25) still lands on local midnight.

### 5.3 4.2 — CSV stream failure

- New `src/lib/attendee-csv.ts`: move `csvCell`, the header, the paging loop
  and the `controller.error` catch out of the route into
  `createAttendeeCsvStream({ event, viewerId, fetchPage })`. `fetchPage` is
  injected (`getAttendeesPage` in the route), so the module imports no Prisma
  and stays unit-testable.
- Route keeps auth, 401/404, headers and `req.signal` wiring only.
- New `tests/unit/attendee-csv.test.ts`: a fake fetcher that returns one page of
  500 rows then throws. Assert the reader rejects (not a clean close), the error
  is logged once with `eventId`, and the rows enqueued before the failure were
  the expected ones. Second test: aborting the stream closes without logging.
- `tests/http/attendees.test.ts`: keep the happy path and client-abort tests;
  add a note that status cannot change post-headers and that the controlled
  error is asserted at the stream layer.

### 5.4 3.4 — concurrency profiles

Wire `TEST_ROUNDS` into CI only (S6): `TEST_ROUNDS=2` on PRs, `6` on nightly.
No test change needed — the round count is already env-tunable.

### 5.5 Bookkeeping

Flip 3.8 (6), 3.9 (1), 4.2 (1), 3.4 (1) and add the note to 6.1 that action
ordering is E2E-covered.

Acceptance: met — `test:db` 142 green, `npm test` 217 green, `test:http` 32
green after the route move (`src/app/api/events/[id]/attendees/route.ts` now
only does auth/404/headers and delegates to `createAttendeeCsvStream`).

---

## 6. Slice S3 — Coverage and suite hygiene (0.75 day)

### 6.1 Coverage

- `npm i -D @vitest/coverage-v8` (same major as `vitest` 4).
- `vitest.config.mts`: `coverage.provider = 'v8'`, `reportsDirectory = 'coverage'`
  (already gitignored), `include: ['src/lib/**']`,
  `exclude: ['src/generated/**']`, reporters `text-summary` + `lcov`.
- Thresholds, per the plan's targets and calibrated from S0:

| Group | Threshold |
|---|---|
| `time.ts`, `event-validation.ts`, `discovery.ts`, `calendar.ts`, `search.ts` | 90% lines |
| `rsvp.ts`, `rate-limit.ts`, `notifications.ts`, `event-notifications.ts`, `events.ts`, `check-in.ts`, `update-event.ts`, `invite.ts` | 80% lines |
| `src/generated/**`, pages, components | no threshold (E2E covers) |

- `npm run test:coverage` = `vitest run --project unit --project components --project db --coverage`.
  Requires the branch; therefore it runs in the CI DB job, not the unit job.
- First two runs: report only. Then set `thresholds` to measured-minus-2 and
  enable the gate. If a target is unreachable, record the measured number and
  the reason in `testing_plan.md` rather than lowering the test quality.

### 6.2 Flake quarantine

- Replace every `waitForTimeout` in `tests/e2e/` with a web-first wait
  (`expect(locator).toContainText`, `expect.poll` on visible state,
  `page.waitForURL`). The two-context races in `rsvp.spec.ts` should
  `expect.poll` the DB row, not sleep.
- New `tests/unit/test-hygiene.test.ts`: scans `tests/e2e/**/*.spec.ts` (and the
  setup/support files) and fails on `waitForTimeout` or `test.only`. This is the
  guard that keeps the fix from regressing.
- Document the quarantine policy in `TESTING.md`: `@quarantine` in the title,
  never in `@smoke`, one issue link + owner per entry, weekly review; the list
  must be empty at Phase 6 close.

### 6.3 Retire obsolete probes

| Retired | Replaced by |
|---|---|
| `scripts/timezone-check.ts` | `tests/unit/time.test.ts` (19 tests incl. DST) |
| `scripts/search-check.ts` | `tests/unit/search.test.ts` + `tests/db/queries.test.ts` (literal `%`/`_`) |
| `scripts/rate-limit-check.ts` | `tests/db/rate-limit.test.ts` |
| `scripts/rsvp-concurrency.ts` | `tests/db/rsvp-concurrency.test.ts` |

Delete the four scripts and the three tracked `.log` artifacts;
`package.json` → `verify` = `typecheck && eslint … && next build`. Keep
`scripts/preflight.ts` (used by the backfill), `rate-limit-cleanup.ts`,
`backfill-time-zone.ts`, `sql/`, `start-test-app.ts`, `test-db.ts`.

### 6.4 Documentation edits

`TESTING.md`: fault-injection policy and helper, script-test pattern and the
`.env`/`.env.test` precedence note, coverage commands and thresholds, quarantine
policy, retired-probes table, new CI commands, and the S4 branch-cleanup rule.
`testing_plan.md`: flip the boxes; the Known-gaps section loses the CSV-stream
and script items and gains "perf is nightly-only".

Acceptance: `npm run verify` green without the probes; `npm run test:coverage`
prints the thresholds; the hygiene guard fails when a `waitForTimeout` is added
back (spot-check, then revert).

---

## 7. Slice S4 — Deployment safety (0.5 day)

### 7.1 Migration drift

- `scripts/migrate-drift.ts`: requires `.env.test`, `assertTestDatabaseSafety()`,
  then (Prisma 7 flag names, verified with `prisma migrate diff --help`):

  ```
  prisma migrate diff \
    --from-config-datasource \
    --to-schema prisma/schema.prisma \
    --exit-code
  ```

  `--from-config-datasource` reads `DATABASE_URL_UNPOOLED` through
  `prisma.config.ts`, so the branch must already be migrated. Exit 0 = in sync,
  2 = drift (print the human-readable diff plus `--script` SQL), 1 = error.
  Prints hosts only. The offline `--from-migrations` variant needs a shadow
  database, which Neon does not allow a branch role to create — do not use it.
  Run it after `prisma migrate deploy` in `db:test:up` and in the CI DB job.
- `npm run db:test:drift` maps to that script.
- New DB test (in `constraints.test.ts`): schema and migrations agree — spawn
  the same diff and expect 0. This makes drift fail locally too, not just in CI.

### 7.2 Branch cleanup on failure

- `scripts/with-test-branch.ts`: `up` → run the given command with inherited
  stdio → `down` in `finally`, forwarding the child's exit code. Command:
  `npm run test:branch -- "npm run test:db"`. This gives local parity with the
  CI `if: always()` teardown and fixes "deletion runs even when tests fail"
  without relying on the operator remembering.
- Document that CI uses the explicit steps, not the wrapper, so the branch
  survives long enough to collect diagnostics (traces/logs).

### 7.3 Bookkeeping

Flip 6.3: fresh-branch apply (CI), drift (CI + local test), CHECK constraints,
cascades, `db push` forbidden, branch deletion on failure.

Acceptance: introduce a deliberate schema edit locally, confirm the drift check
fails with a readable diff, revert; wrapper leaves no branch and no `.env.test`
after a forced failing command.

---

## 8. Slice S5 — Performance smoke (0.5–1 day, P2)

### 8.1 Project

`vitest.config.mts` gains a `perf` project:
`include: ['tests/perf/**/*.test.ts']`, node env, `tests/setup/db.ts`,
`fileParallelism: false`, `testTimeout: 180_000`. `npm run test:perf`. Not part
of `test:all`; nightly only.

### 8.2 Tests

| File | Test | Assertion |
|---|---|---|
| `browse.perf.test.ts` | 500 public events (30-day spread) + 1,000 RSVPs seeded with `createMany`, 5 warm-up calls, 20 measured `getPublicEventsPageCore` calls | p95 ≤ `PERF_BROWSE_P95_MS` (default = 3× the S0-measured baseline, min 250 ms); logs p50/p95 |
| `rsvp.perf.test.ts` | 20 sequential `upsertRsvpCore` writes alternating GOING/MAYBE on an uncapped event | p95 ≤ `PERF_RSVP_P95_MS`; logs p50/p95 |
| `wishlist.perf.test.ts` | 6 wishlisted events | `prisma.rSVP.findMany` invoked exactly twice (spy), proving the 1+N query was not reintroduced |
| `tests/http/attendees.test.ts` (extend) | 1,200 attendees | body arrives in ≥3 chunks and the first chunk is much smaller than the body — proves the export streams instead of buffering |

Record the measured numbers in this file; the budgets are meaningless without
them. 6.2's four boxes flip on: browse p95, RSVP p95, no N+1, streaming.

Acceptance: `npm run test:perf` green on the branch, prints p50/p95, and the
wishlist query count is 2.

---

## 9. Slice S6 — CI pipeline (1 day)

`.github/workflows/ci.yml` (new). Triggers: `pull_request`, `push` to `main`,
`schedule: 02:17 UTC`, `workflow_dispatch`. `concurrency` per ref with
`cancel-in-progress` on PRs. `permissions: contents: read`. Node 22 + `npm ci`
with npm cache.

| Job | Runs on | Steps | Branch |
|---|---|---|---|
| `static` | every PR | typecheck, lint, `next build` with **dummy** build env (`DATABASE_URL` placeholder pooler URL, `NEON_AUTH_BASE_URL`, `NEON_AUTH_COOKIE_SECRET`, `APP_TIME_ZONE`) | none |
| `unit` | every PR | `npm test` | none |
| `db` | PR + main + nightly | `db:test:up` → `npm run test:coverage` (unit+components+db) → `db:test:drift` → `always(): db:test:down` | own |
| `http` | PR + main | `db:test:up` → `npm run test:http` → `always(): down` | own |
| `e2e-smoke` | PR | `db:test:up` → `npm run test:e2e:smoke` → `always(): down` | own |
| `e2e-full` | main + nightly | `db:test:up` → `npm run test:e2e` (desktop + mobile) → `always(): down` | own |
| `perf` | nightly | `db:test:up` → `npm run test:perf` → `always(): down` | own |
| `required` | every PR | fails unless `static`, `unit`, `db`, `http`, `e2e-smoke` all succeeded | — |

Details that matter:

- **Secrets precondition.** A tiny `secrets-check` job emits
  `has-secrets=true|false`; DB-backed jobs are gated on it because `secrets.*`
  is not reliable in a job-level `if`. On a fork PR without secrets those jobs
  are skipped with a `::notice`, and `required` only enforces the secret-free
  jobs — document this limitation instead of letting PRs sit red.
- **Env.** `.env.test` is written by `db:test:up` inside the job; never uploaded.
  Artifacts: `playwright-report/`, `test-results/` (traces, videos, server logs),
  `coverage/`, retention 7 days (14 on nightly). Add an artifact inspection step
  that fails if any artifact contains `postgresql://` or `napi_`.
- **Concurrency profiles.** `TEST_ROUNDS=2` on PRs, `6` nightly (closes the 3.4
  CI-profile item).
- **`HTTP_TEST_SKIP_BUILD=1`** in `http` only if `.next` is cached and keyed on
  the lockfile + source hash; otherwise let the global setup build.
- **Fail-the-run coverage.** Wire `coverage.thresholds` (S3) so the `db` job
  fails; upload `lcov` regardless with `if: always()`.
- **Cache** `~/.npm` and Playwright browsers (`~/.cache/ms-playwright`) keyed on
  `package-lock.json`; never cache `test-results/`.

Bookkeeping: CI checklist (12 boxes) and the three coverage bullets flip here.
`Definition of done` → "CI enforces the suite" flips after the first green
nightly.

Acceptance: one PR run with all jobs green (or explicitly skipped without
secrets), one nightly run with `e2e-full` + `perf`, branch list shows no
leftovers (`npm run db:test:status` locally, Neon console for CI branches), and
no credential string appears in any uploaded artifact.

---

## 10. Bookkeeping and DoD closure map

| `testing_plan.md` location | Closed by | Evidence to cite |
|---|---|---|
| 6.1 (7) | S1 | `tests/db/fault-injection.test.ts` + existing rate-limit/reminder tests |
| 6.2 (4) | S5 | `tests/perf/*`, extended HTTP streaming assertion |
| 6.3 (6) | S4 + S6 | drift script/test, CI `always()` teardown, existing constraint tests |
| 6.4 (4) | already | S3/S6 edits keep it true |
| CI checklist (12) | S6 | workflow file + first green runs |
| Coverage bullets (3) | S3 + S6 | thresholds in `vitest.config.mts`, lcov artifact |
| 3.8 (6) | S2 | script spawn tests + handler log test |
| 3.9 (1) | S2 | `when filters` describe |
| 4.2 (1) | S2 | `attendee-csv` unit tests |
| 3.4 (1) | S6 | `TEST_ROUNDS` per job |
| Traceability (8) | S6 sweep | point each at its existing spec; no new tests unless a pointer is missing |
| DoD: regression-test rule, manual QA reduced, CI enforces | S3/S6 | `TESTING.md` PR checklist, manual-only list, required checks |

---

## 11. Acceptance criteria for Phase 6

1. `npm run test:branch -- "npm run test:db"` and `npm run test:http` green on a
   fresh branch; branch gone afterwards.
2. `npm run test:e2e -- --repeat-each=2` green, with zero `waitForTimeout` and
   zero `@quarantine` entries. F1 is fixed, so the repeated run is now the gate
   rather than a diagnostic.
3. `npm run test:perf` prints p50/p95 within the recorded budgets and the
   wishlist query count is 2.
4. `npm run verify` green without the four retired probes; the three `.log`
   artifacts are deleted.
5. `npm run test:coverage` meets the calibrated thresholds; the gate is enabled.
6. CI: PR run green (smoke only), nightly run green (full E2E + perf), one
   branch per job, no leftover branches, artifacts contain no credentials.
7. Every Phase 6 / CI / 3.8 / 3.9 / 4.2 / 3.4 checkbox is checked or carries a
   one-line reason, in the style of Phases 1–5.
8. `TESTING.md` lets a new contributor run layers, fault-injection tests,
   script tests, coverage and perf without reading this plan.

---

## 12. Risks

| Risk | Mitigation |
|---|---|
| Spawned scripts read `.env` (production URLs) if an env var is missing | Parent asserts the branch guard and passes both URLs explicitly; the script prints its target host and the test asserts the branch endpoint before any write. |
| Perf budgets flake on Neon latency | Nightly-only, 3× measured baseline, env override, log p50/p95 instead of only pass/fail. |
| Coverage targets from the plan are unreachable | Measure first, report-only twice, then gate at measured-minus-2 and record the deviation. |
| Retiring probes loses an invariant | §6.3 mapping table; delete only after `npm run test:db`/`test` prove the replacement is green twice. |
| Fork PRs have no Neon secrets | Skip DB jobs via `secrets-check`, keep `required` to the secret-free subset, document. |
| `db:test:up` twice in parallel against one project | Each job creates its own branch; `test-base` is read-only at that point. Watch for Neon project branch limits in nightly. |
| CSV extraction changes the route | Pure move; existing HTTP tests assert status, headers, 1,200-row content and client abort. |
| CI runtime/cost | PR smoke only; full desktop E2E and perf on main/nightly; Playwright browser cache. |
| F1 regression (a render-time cookie write crashing the page again) | Fixed: guarded writer + three regression tests (unit SDK, unit writer, E2E guard). A repeated E2E run is the gate; keep it in nightly once green. |

---

## 13. Open decisions (need sign-off before S6)

1. **CI provider and secrets.** GitHub Actions is assumed. Are `NEON_API_KEY`
   and `NEON_PROJECT_ID` available as repository secrets, and is running
   DB-backed jobs on `pull_request` from forks acceptable (otherwise they skip)?
2. **Coverage gate.** Agree to calibrated thresholds (measured-minus-2) instead
   of the plan's literal 90/80, and to enabling the gate after two report-only
   runs?
3. **Performance budgets.** Accept "3× measured p95, nightly only" (6.2 stays
   P2), and is the streaming/N+1 assertion part of the HTTP suite or perf only?
4. **Probe retirement.** Confirm the four legacy probes can be deleted now
   (parity table §6.3), or keep the two read-only ones in `verify` for another
   cycle?

## 14. Sequence and effort

S0 baseline (0.25) → S1 fault injection (1) → S2 deferred gaps (1) →
S3 coverage + hygiene (0.75) → S4 deployment safety (0.5) →
S5 perf (0.5–1) → S6 CI + bookkeeping (1). Total ≈ 5–5.5 days; S1 and S2 alone
close more than half the open checkboxes and need no CI decisions.

S0, S1, and S2 are done (2026-10-30), and Finding F1 (session refresh during
render) is fixed with regression coverage (0.5 day). S5 can now use the
repeated run as its gate.
