# Testing Plan — Event Manager

Status: in progress — Phase 0 (harness), Phase 1 (unit), Phase 2 (component),
and Phase 3 (DB integration) implemented
Last updated: 2026-10-27

This document is the working checklist for building the test suite. It is
phased so that useful coverage lands early. Phase 0 (harness), Phase 1 (unit),
Phase 2 (component), and Phase 3 (DB integration) tests are implemented; Phase 4
(HTTP contract) and Phase 5 (E2E) are still unchecked. Blocked or externally
dependent items carry a note explaining what is missing.

## Decisions already made

- [x] Use the full test pyramid: static checks, unit, component, real-DB
      integration, HTTP contract, browser E2E, and non-functional checks.
- [x] Use an ephemeral Neon branch per CI run for database-backed tests.
- [x] Use real Neon Auth test users for authenticated E2E flows.
- [x] Allow small production-code seams where testing is otherwise impractical
      (for example splitting `connection()` from query cores).
- [x] Use **Playwright** for all browser/E2E and browser-level accessibility
      work. Do not add Cypress, Jest, or a second browser runner.
- [x] Use **Vitest** for unit, component, integration, and HTTP contract tests.

## Test layers

| Layer | Tool | What it proves | Database |
|---|---|---|---|
| Static | `tsc`, ESLint, `next build` | Types, lint, build integrity | No |
| Unit | Vitest (node) | Pure logic: time, validation, discovery, calendar, search | No |
| Component | Vitest + jsdom + Testing Library | Client state machines and error handling | No |
| DB integration | Vitest (node, serial) | Invariants, concurrency, queries, constraints | Ephemeral Neon branch |
| HTTP contract | Vitest + fetch + `pg` | Route handlers, CSV, ICS, headers, authz | Test branch + running server |
| E2E | Playwright | Real user journeys with real auth and sessions | Test branch + production build |
| Non-functional | Vitest, Playwright, axe | Concurrency, fault injection, a11y, security, responsive | Test branch |
| Ops/jobs | Vitest + CLI | Scheduled GC, cleanup/backfill scripts, preflight guards | Test branch |

Rule of thumb: prove data correctness and security at the lowest layer that can
prove them; prove user-visible behavior through Playwright. Avoid duplicating
the same assertion in multiple layers unless each layer has a distinct failure
mode.

---

## Phase 0 — Test harness and safety

Goal: one command runs each layer, test data is isolated, and it is impossible
to write to production by accident.

### 0.1 Tooling

- [x] Add dev dependency `@vitejs/plugin-react`.
- [x] Add dev dependency `jsdom`.
- [x] Add dev dependency `vite-tsconfig-paths`.
- [x] Add dev dependency `@testing-library/react`.
- [x] Add dev dependency `@testing-library/dom`.
- [x] Add dev dependency `@testing-library/user-event`.
- [x] Add dev dependency `@testing-library/jest-dom`.
- [x] Add dev dependency `@playwright/test` and install browsers (Chromium
      installed; Firefox/WebKit only if the matrix is later required).
- [x] Add dev dependency `@axe-core/playwright` for accessibility scans.
- [x] Branch management path: Neon REST API in `scripts/test-db.ts` (no
      `npx neon` / pinned CLI dependency).
- [ ] Confirm the CI Node version ships full ICU (timezone tests depend on it).
      Local Node 24.16 has full ICU; pin this when the pipeline lands. (CI/docs
      concern, not code.)
- [x] Optional: add `fast-check` for timezone/URL property tests. Out of scope —
      not installed; table-driven tests cover the same cases.
- [x] Optional: add `ical.js` for strict ICS parsing. Out of scope — not
      installed; unit tests assert ICS structure directly.
- [x] Optional: add `csv-parse` for CSV structural assertions. Out of scope —
      not installed; unit tests assert CSV output directly.

### 0.2 Configuration files

- [x] Create `vitest.config.mts` with separate projects:
  - [x] `unit` — node environment, `tests/unit/**`.
  - [x] `components` — jsdom, `tests/components/**`, Testing Library setup.
  - [x] `db` — node, serial (`fileParallelism: false`), `tests/db/**`,
        `.env.test` loaded before imports.
  - [x] `http` — node, `tests/http/**` (empty until Phase 4; root
        `passWithNoTests` keeps the command a clean no-op).
  - [x] Shared path alias so `@/*` resolves in tests (`vite-tsconfig-paths`).
- [x] Create `playwright.config.ts`:
  - [x] Dedicated port for the app under test (`localhost:3100` by default,
        overridable with `TEST_BASE_URL`). Must stay on the `localhost`
        hostname: Neon Auth's `allow_localhost` does not trust `127.0.0.1`.
  - [x] `webServer` builds and starts the production app.
  - [x] Chromium project plus a mobile-viewport project (Pixel 7).
- [ ] `auth.setup.ts` project that creates and stores role states. Phase 5 item.
- [x] Trace/video/screenshot capture on failure.
  - [x] CI retries and HTML report artifact.
- [x] Create `.env.test.example` with placeholders.
- [x] Create `.env.test` locally and ensure it is gitignored. Generated by
      `npm run db:test:up` (after the one-time `npm run db:test:base`); the file
      is gitignored and contains the branch DB + branch-scoped auth URLs.
- [x] Create test setup files:
  - [x] Unit/component setup (`jest-dom`, cleanup, pinned `APP_TIME_ZONE`;
        console policy is not enforced yet).
  - [x] DB setup (load `.env.test`, assert branch identity, disconnect on
        teardown).

### 0.3 NPM scripts

- [x] `test` — unit + component, no DB, fast.
- [x] `test:watch` — watch mode for unit + component.
- [x] `test:db` — DB integration only.
- [x] `test:http` — HTTP contract only.
- [x] `test:e2e` — Playwright only.
- [x] `test:all` — unit + component + DB + HTTP + E2E.
- [x] `test:ci` — unit + component, then DB. Artifact upload is CI-side and not
      wired yet.
- [x] `db:test:up` — create branch, write `.env.test`, apply migrations.
- [x] `db:test:down` — delete the branch and remove `.env.test`.
- [x] `verify:full` — existing `verify` plus `test:all`.
- [x] `verify:db` is now an alias for `test:db`; the original destructive probes
      are retained but no longer run from that script.

### 0.4 Test database lifecycle

- [x] Create a dedicated data-free `test-base` Neon branch so ephemeral
      branches never inherit production data or PII. Implemented as
      `npm run db:test:base`. Neon refused every schema-only init source for
      this project (`legacy web access role: anonymous`, owned by Neon Auth), so
      the base is a one-time copy-on-write branch that is immediately scrubbed:
      every `public` row removed, auth identities removed, auth config kept, then
      verified empty. `_prisma_migrations` stays baselined.
- [x] Create one ephemeral branch per run from `test-base`. Implemented in
      `scripts/test-db.ts` (`db:test:up`): waits for `ready`, reuses/provisions
      branch-scoped Neon Auth, allows the `localhost` origin for browser auth,
      writes `.env.test`, migrates, and re-verifies the branch is data-free. Run
      against Neon on 2026-10-27; CI wiring is separate.
- [x] Apply migrations with `DATABASE_URL_UNPOOLED` via `prisma migrate deploy`.
- [x] Run application code against the pooled `DATABASE_URL` so advisory locks
      are exercised through PgBouncer transaction mode (the guard rejects a
      non-`-pooler` host).
- [x] Assert the pooled and unpooled URLs point at the same branch.
- [ ] Always delete the branch in CI cleanup, including on failure. The setup
      script deletes a half-initialized branch; CI cleanup is not wired. (CI
      concern, not code.)
- [x] Define local behaviour for a reused test branch: documented in
      `TESTING.md` (`.env.test.example`), with explicit cleanup and a unique
      `RUN_ID` fixture prefix.
- [x] Confirm `prisma migrate status` is clean before tests start. Enforced by
      `db:test:up` after `migrate deploy`; verified on the first real branch.
- [x] Confirm branch creation does not copy `neon_auth` users. `test-base` was
      scrubbed of auth identities and `db:test:up` asserts
      `neon_auth."user" = 0` before handing the branch to tests.

### 0.5 Safety guards

- [x] Refuse DB tests unless `TEST_DB_ALLOW=1`.
- [x] Print resolved hosts only, never credentials (`tests/support/env.ts`,
      reusing the `preflight.ts` host-only pattern).
- [x] Reject the run when the test host equals the production host in `.env`.
- [x] Reject the run when `DATABASE_URL` and `DATABASE_URL_UNPOOLED` disagree
      on branch identity.
- [x] Forbid `prisma db push` in scripts, docs, and CI commands (no repo script
      uses it; `TESTING.md` states the rule).
- [x] Reject a run whose `NEON_AUTH_BASE_URL` points at the app auth service in
      `.env`, and fail Playwright when `.env.test` has no branch-scoped auth
      URL. Covered by `tests/unit/test-db-guard.test.ts`.
- [ ] Ensure E2E teardown deletes only rows created by the run, or delete the
      whole branch. Policy is documented; E2E fixtures/teardown arrive in
      Phase 5.
- [x] Add a documented "never run against production" warning to
      `TESTING.md`.

### 0.6 Factories and test helpers

- [x] `makeEvent` with defaults for title, description, date, location, cap,
      visibility, category, and organizer id.
- [x] `makeRsvp` with status, timestamps, check-in fields, and notification
      preference.
- [x] `makeComment`.
- [x] `makeNotification` including `eventId: null` cancellation rows.
- [x] `makeRateLimit` with controllable `windowStart`.
- [x] Deterministic future/past date helpers.
- [x] Unique run prefix for all fixture titles and user ids.
- [x] `resetDomainTables()` that truncates only `Event`, `RSVP`, `Comment`,
      `Notification`, and `RateLimit`; never `neon_auth`.
- [ ] Auth helpers for E2E:
  - [ ] Create organizer, attendee, and outsider users.
  - [ ] Capture user ids for DB fixtures.
  - [ ] Save and reuse storage states.
  - [ ] Clean up notifications by user id where event cascade does not apply.
  - Deferred to Phase 5. Unblocked: branch auth is proven to create users
    without email verification, and `db:test:up` trusts the `localhost` origin.

### 0.7 Minimal production seams

These changes must preserve current behavior.

- [x] Split `connection()` from query cores in `src/lib/events.ts`:
  - [x] Add pure `*Core` functions with no `connection()`.
  - [x] Keep thin request-time wrappers that call `connection()` then core.
  - [x] Update pages to use the wrappers; tests use the cores (pages call the
        unchanged wrapper names).
- [x] Extract invite-link orchestration from server actions into
      `src/lib/invite.ts`:
  - [x] Create core (idempotent claim).
  - [x] Regenerate core.
  - [x] Revoke core.
  - [x] Accept core (GOING or WAITLISTED).
- [x] Extract event notification recipient selection into a lib module
      (`src/lib/event-notifications.ts`):
  - [x] Update fan-out recipients.
  - [x] Cancellation fan-out recipients.
  - [x] Comment fan-out recipients and 20-recipient cap.
- [x] Export `createRateLimitCleanupHandler(runCleanup)` from
      `functions/rate-limit-cleanup.ts`; the default handler keeps its
      behavior.
- [x] Add an injectable clock only if fake timers are insufficient; the cores
      accept an optional `now` and unit tests use `vi.setSystemTime`, so no
      global clock abstraction was added.

### 0.8 Baseline and documentation

- [x] Port `scripts/timezone-check.ts` into `tests/unit/time.test.ts` +
      `tests/unit/event-validation.test.ts`.
- [x] Port `scripts/search-check.ts` into `tests/unit/search.test.ts` +
      `tests/unit/discovery.test.ts`.
- [x] Port `scripts/rate-limit-check.ts` into `tests/db/rate-limit.test.ts`.
- [x] Port `scripts/rsvp-concurrency.ts` into
      `tests/db/rsvp-concurrency.test.ts`.
- [x] Keep the original scripts until parity is proven; `verify` still runs the
      read-only probes and `verify:db` now runs the DB suite.
- [x] Write `TESTING.md` with:
  - [x] How to set up `.env.test`.
  - [x] How to create/delete a test branch.
  - [x] Which commands are safe locally and in CI.
  - [x] The "never test against production" rule.
  - [x] How to add a regression test for a bug.

---

## Phase 1 — Unit tests

Target: about 90% line coverage for the modules below. No database, no network.

### 1.1 `src/lib/time.ts`

- [x] `isValidTimeZone` accepts valid zones and rejects empty/garbage.
- [x] `resolveTimeZone` falls back for null, undefined, and invalid input.
- [x] `DEFAULT_TIME_ZONE` respects `APP_TIME_ZONE`; falls back to UTC when
      unset or invalid (use module reset to test both).
- [x] `zonedTimeToUtc` converts a normal wall clock correctly.
- [x] `zonedTimeToUtc` accepts optional seconds.
- [x] `zonedTimeToUtc` trims surrounding whitespace.
- [x] `zonedTimeToUtc` rejects Feb 31, hour 24, and garbage input.
- [x] Round-trip through `toDatetimeLocalValue` for UTC, New York, Berlin, and
      Tokyo in summer and winter.
- [x] Spring-forward gap behavior is documented and asserted.
- [x] Fall-back ambiguous time resolves to the earlier instant, as documented.
- [x] `formatEventDate` shows the correct wall clock and zone abbreviation.
- [x] `formatEventDate` with a null legacy zone uses the app fallback.
- [x] `toDatetimeLocalValue` emits the exact `datetime-local` shape.
- [x] `startOfDayIn` returns local midnight.
- [x] `addDaysInZone` lands on local midnight across 23-hour and 25-hour DST
      days.
- [x] `calendarDayDiffInZone` returns 0 for the same local day and 1 for the
      next local day.
- [x] Optional property test: random instants × representative zones round-trip
      exactly. Out of scope — `fast-check` not installed; deterministic zone
      cases cover the same cases.

### 1.2 `src/lib/event-validation.ts`

- [x] Missing or whitespace-only title is rejected.
- [x] Title over 200 characters is rejected.
- [x] Missing or whitespace-only description is rejected.
- [x] Description over 5000 characters is rejected.
- [x] Missing or whitespace-only location is rejected.
- [x] Location over 300 characters is rejected.
- [x] Valid category is kept.
- [x] Unknown category falls back to `OTHER`.
- [x] Capacity empty means uncapped.
- [x] Capacity non-integer, zero, negative, or over 100,000 is rejected.
- [x] Create mode rejects a past date.
- [x] Edit mode allows a past date.
- [x] Missing/empty timezone leaves `timeZone` null and parses in
      `APP_TIME_ZONE`.
- [x] Invalid/spoofed timezone is dropped and parses in `APP_TIME_ZONE`.
- [x] Valid browser timezone is kept and the stored instant is correct.
- [x] Rolled-over date (Feb 31) is rejected.
- [x] Whitespace is trimmed in persisted fields.

### 1.3 `src/lib/discovery.ts`

- [x] Empty input returns all defaults.
- [x] Array search params use the first value.
- [x] `q` is trimmed and truncated to the maximum.
- [x] Unknown category becomes null.
- [x] Unknown `when` and `sort` fall back to defaults.
- [x] `organizer` is trimmed, truncated, and blank becomes null.
- [x] `page` parses integers, rejects negatives/NaN, and floors values.
- [x] `eventListHref` omits default values.
- [x] `eventListHref` includes non-default values.
- [x] Changing any filter key resets the page to 1.
- [x] Changing only the page keeps the filters.
- [x] `hasNarrowingFilters` ignores sort but notices q/category/when/organizer.
- [x] `whenLabel` and `sortLabel` fall back safely.
- [x] `categoryFilterHref` produces the expected URL.
- [x] Dashboard params: defaults, malformed values, q truncation, view/sort
      validation.
- [x] `dashboardHref` omits defaults and round-trips.
- [x] `hasDashboardQuery`, `dashboardViewLabel`, `dashboardSortLabel`.

### 1.4 `src/lib/search.ts`

- [x] `%` is escaped.
- [x] `_` is escaped.
- [x] Backslash is escaped.
- [x] Combined metacharacters are escaped once each.
- [x] Plain text is unchanged.
- [x] Optional property test: escaped input matches literally. (A table-driven
      un-escape check is in place; `fast-check` is not installed.)

### 1.5 `src/lib/calendar.ts`

- [x] ICS text escapes backslash.
- [x] ICS text escapes semicolon.
- [x] ICS text escapes comma.
- [x] ICS text converts CRLF, CR, and LF to `\n`.
- [x] `formatIcsDate` emits UTC `YYYYMMDDTHHMMSSZ`.
- [x] `getCalendarEnd` adds exactly two hours.
- [x] `buildIcs` includes required VCALENDAR/VEVENT properties.
- [x] `buildIcs` uses CRLF line endings.
- [x] `buildIcs` UID uses the host when origin is valid.
- [x] `buildIcs` falls back to `eventplanner` for missing/invalid origin.
- [x] `buildIcs` includes URL only for a valid origin.
- [x] `buildIcs` accepts an injected `now` for deterministic DTSTAMP.
- [x] Title/location/description containing newlines cannot inject ICS lines.
- [x] Google Calendar URL has the correct action, text, dates, details,
      location, and optional website parameter.

### 1.6 Pure helpers in `src/lib/events.ts`

- [x] `resolveOrganizerName` prefers a trimmed name.
- [x] `resolveOrganizerName` falls back to the email local part.
- [x] `resolveOrganizerName` returns null when neither exists.
- [x] `resolveOrganizerName` caps at 120 characters.
- [x] `organizerAccentClass` is deterministic.
- [x] `organizerAccentClass` always returns a known accent class.
- [x] `spotsLeft` returns null for uncapped events.
- [x] `spotsLeft` clamps at zero.
- [x] `startsInLabel` returns Today, Tomorrow, and In N days using mocked time.

### 1.7 Other pure modules

- [x] `src/lib/action-errors.ts` recognizes `NEXT_REDIRECT`.
- [x] It recognizes `NEXT_HTTP_ERROR_FALLBACK`.
- [x] It rejects unrelated digests and non-string digests.
- [x] `src/lib/categories.ts` covers every enum value and label.
- [x] `isEventCategory` rejects unknown/non-string input.
- [x] `categoryLabel` falls back to Other.
- [x] `MAX_COMMENT_LENGTH` equals the DB CHECK limit.
- [x] Rate-limit message is non-empty and every scope has a positive budget.

---

## Phase 2 — Component tests

Environment: jsdom + Testing Library. Mock server actions, `next/navigation`,
and browser APIs. Do not render async Server Components; use Playwright for
pages.

### 2.1 `RsvpControls`

- [x] Past event renders the ended state.
- [x] Current status is reflected with `aria-pressed`.
- [x] GOING calls `setRsvp` with `GOING`.
- [x] MAYBE calls `setRsvp` with `MAYBE`.
- [x] NOT_GOING calls `setRsvp` with `NOT_GOING`.
- [x] Full event with no RSVP shows the wishlist CTA.
- [x] Wishlist CTA calls `joinWishlist`.
- [x] Full event with a status shows the "choosing Going joins wishlist"
      warning instead of the CTA.
- [x] WAITLISTED shows the queue position.
- [x] Successful wishlist result shows the position message.
- [x] Promoted banner appears for a promoted GOING row.
- [x] Dismiss calls `dismissPromotion` and hides the banner.
- [x] Action `{ok:false}` shows an alert.
- [x] Thrown action shows the generic error.
- [x] Pending state always clears after a rejection (stuck-button regression).
- [x] Framework redirect digest is rethrown, not shown as an error.
- [x] Notify checkbox updates optimistically.
- [x] Notify checkbox reverts when the action fails or throws.
- [x] Cancel asks for confirmation and does nothing on decline.
- [x] Cancel clears local status/position/promotion on success.
- [x] Pending labels render for each in-flight operation.

### 2.2 `RosterCheckInButton`

- [x] Initial checked/unchecked state renders correctly.
- [x] Checking calls `checkInAttendee` and updates optimistically.
- [x] `{ok:false}` reverts and shows an alert.
- [x] A thrown error reverts and shows an alert.
- [x] Pending disables the control and shows "Saving...".
- [x] Undo calls `undoCheckIn`.

### 2.3 `InviteLinkManager`

- [x] No token shows the create button.
- [x] Create calls the action and shows the relative link.
- [x] Copy builds an absolute URL and writes to the clipboard.
- [x] Clipboard failure shows a manual-copy message.
- [x] Regenerate asks for confirmation.
- [x] Regenerate replaces the displayed token.
- [x] Revoke asks for confirmation.
- [x] Revoke clears the link and shows the revoked message.
- [x] Action errors show an alert.
- [x] Thrown errors show the generic message.
- [x] Pending disables all controls.

### 2.4 Filters

- [x] `EventFilters` category click navigates to the expected href.
- [x] Active category toggles off.
- [x] When select navigates with the new value.
- [x] Sort select navigates with the new value.
- [x] Search input is debounced before navigation (fake timers).
- [x] Search resyncs when the URL-provided query changes.
- [x] Active chips render for q/category/when/sort/organizer.
- [x] Removing a chip navigates to the correct href.
- [x] Clear all resets to the default URL.
- [x] `aria-pressed` reflects the active category.
- [ ] Pending state exposes `data-pending`. — not testable with the mocked
      `next/navigation` push (the `useTransition` flushes synchronously, so
      `data-pending` is never `true` at assert time). Revisit when a real
      router transition can be driven, or cover via Playwright.
- [x] `DashboardFilters` view/search/sort behave the same way.

### 2.5 Pagination and page navigation

- [x] Previous/next hrefs are correct.
- [x] Boundaries disable or omit unavailable pages.
- [x] Page count and current page render correctly.
- [x] `PageNav` `hrefForPage` is honored.

### 2.6 Forms and auth components

- [x] Sign-in requires email and password.
- [x] Sign-in shows the provider error message.
- [x] Sign-in disables submit while pending.
- [x] Sign-in pushes `/` and refreshes on success.
- [x] Sign-up validates required fields and minimum password length.
- [x] Sign-up shows provider errors and succeeds.
- [x] Google button has the expected label and calls the provider.
- [x] `CommentForm` rejects empty input.
- [x] `CommentForm` enforces the max length and clears on success.
- [x] `CommentForm` shows action and thrown errors.
- [x] `DeleteEventButton` confirms before calling the action.
- [x] `CommentDeleteButton` calls the action and handles errors.
- [x] `LeaveWishlistButton` confirms and handles errors.
- [x] `DismissPromotionButton` hides itself on success.
- [x] Notification mark-read / mark-all-read buttons call actions and handle
      errors.
- [x] `AcceptInviteButton` calls the action and handles success/error.

### 2.7 Shared UI state

- [x] `useActionFeedback` sets/clears pending correctly.
- [x] It clears stale errors before each attempt.
- [x] It uses the provided fallback message.
- [x] It returns the action result.
- [x] It rethrows framework control flow.
- [x] `ErrorFallback` calls `retry()` rather than `reset()`.
- [x] It renders the digest when present.
- [x] It logs the render error once per error change.
- [x] `NavbarAuthClient` renders loading, signed-out, and signed-in states.
- [x] `SignOutButton` calls the auth client.
- [x] `CalendarLinks` renders the ICS link and Google link.

---

## Phase 3 — Database integration tests

Environment: Vitest node project, serial, ephemeral Neon branch. Application
code uses the pooled URL. Every test starts from known rows created by
factories.

### 3.1 RSVP core and capacity

- [x] Uncapped event accepts GOING.
- [x] Uncapped event accepts MAYBE.
- [x] Uncapped event accepts NOT_GOING.
- [x] Re-saving the same status is idempotent.
- [x] Changing status updates the same row.
- [x] `attendeeName` is stamped on create and update.
- [x] Capped event with a free seat accepts GOING.
- [x] Capped event with no free seat returns WAITLISTED.
- [x] An existing GOING user can re-click GOING without becoming waitlisted.
- [x] Switching GOING to MAYBE frees a seat.
- [x] Switching GOING to NOT_GOING frees a seat.
- [x] Switching away from GOING promotes the oldest waitlisted user.
- [x] Waitlist position is 1-based and ordered by creation time.
- [x] Equal `createdAt` rows have a deterministic order and position
      (expose/fix a tie-break bug if present).
- [x] Unknown event returns a friendly error.
- [x] Ended event returns "This event has ended."
- [x] No RSVP row is written for an ended event.

### 3.2 Wishlist promotion

- [x] Promotion is oldest-first.
- [x] Promoted rows get `promotedAt`.
- [x] Promoted user ids are returned to the caller.
- [x] No promotion happens while `room <= 0`.
- [x] Promotion drains a queue larger than one batch.
- [x] A user who joins a full event can be promoted in the same transaction
      when a seat is free.
- [x] Promotion preserves the attendee name and other row fields.
- [x] Promotion never exceeds the cap.

### 3.3 Cancellation

- [x] Cancel removes the caller's row.
- [x] Cancel promotes waitlisted users when a seat frees.
- [x] Cancel reports `hadRsvp` correctly.
- [x] Cancel returns organizer id and notify preference.
- [x] Cancel with no row is safe.
- [x] Cancel on an ended event is rejected without writes.
- [x] Cancel on an unknown event is rejected.

### 3.4 Concurrency

- [x] Cap 1 with N concurrent GOING writers produces exactly 1 GOING and
      N−1 WAITLISTED.
- [x] Cap 2 with two concurrent cancellations produces exactly 2 distinct
      promotions.
- [x] No waitlisted row is promoted twice.
- [x] No seat remains unfilled while someone is waitlisted (the two-cancel case
      ends with a full event and an empty queue).
- [x] Capacity raise during concurrent writers cannot overbook.
- [x] Capacity shrink below the GOING count is rejected inside the lock.
- [x] Mutations for one event are serialized (cap-1 race is the proof).
- [x] Mutations for different events do not block each other.
- [x] Repeat concurrency scenarios for a configurable number of rounds
      (`TEST_ROUNDS`).
- [ ] Use reduced rounds/racers on PRs and full rounds nightly. Values are
      env-tunable; CI profiles are not wired yet.
- [x] Verify the same behavior through the pooled connection (the guard requires
      the pooled `-pooler` host).

### 3.5 Invite links

- [x] Create on a private event returns a token.
- [x] Create is idempotent and returns the existing token.
- [x] Two concurrent creates return the same token.
- [x] Public events reject invite creation.
- [x] Regenerate replaces the token.
- [x] Old token no longer resolves after regeneration.
- [x] Revoke clears the token.
- [x] Revoked token no longer resolves.
- [x] Unknown event is handled.
- [x] Accept creates GOING when space is available.
- [x] Accept creates WAITLISTED when full.
- [x] Accept on an ended event is rejected.
- [x] Accept by the host is rejected.
- [x] Accept with an unknown token is rejected.

### 3.6 Check-in

- [x] First check-in stores `checkedInAt` and `checkedInBy`.
- [x] Second check-in is idempotent and returns the same timestamp.
- [x] Checking in a MAYBE/NOT_GOING/WAITLISTED row is rejected.
- [x] Checking in a missing attendee is rejected.
- [x] Undo clears both `checkedInAt` and `checkedInBy`.
- [x] Undo twice is safe and leaves both null.
- [x] Two concurrent check-ins store exactly one timestamp.
- [x] Two concurrent undos leave both fields null.

### 3.7 Rate limiting

- [x] Sequential calls up to the limit are allowed.
- [x] The call after the limit is blocked.
- [x] Twenty concurrent calls allow exactly the configured limit.
- [x] An expired window resets to 1 (set `windowStart` directly; no sleeps).
- [x] The counter is scoped by key.
- [x] A DB error fails open and logs a hashed user id.
- [x] Missing table/DB error does not block the action.
- [x] Stale-row sweep deletes only rows older than the cutoff.
- [x] `deleteStaleRateLimits` returns the removed count.
- [x] The cleanup SQL predicate matches `CLEANUP_AGE_MS`.
- [x] Comment budget is the tightest budget.
- [x] Every declared scope has a positive limit and window.

### 3.8 Scheduled function and scripts

- [x] Cleanup handler returns 403 without the trigger header.
- [x] It deletes stale rows and returns the count with the header (handler
      contract with an injected query, plus the sweep test against the DB).
- [x] It never deletes fresh rows.
- [ ] It returns 500 and logs on DB failure. (500 is asserted; the log line is
      not.)
- [ ] The manual cleanup script dry-run reports without deleting.
- [ ] The manual cleanup script `--apply` deletes and reports the count.
- [ ] The backfill dry-run reports null-zone rows without writing.
- [ ] The backfill `--apply --allow-writes` stamps only null rows.
- [ ] The backfill rejects an invalid `APP_TIME_ZONE`.
- [x] Preflight refuses writes without `--allow-writes` or `PROBE_ALLOW=1`.
- [x] Preflight prints hosts but never credentials.
- [x] Preflight exits non-zero when writes are not allowed.

### 3.9 Query and visibility behavior

- [x] `getPublicEventsPage` returns only public, upcoming events.
- [x] Category filter works.
- [ ] When filters (any/today/week/month) use app-zone day boundaries.
- [x] Search matches title, description, location, and organizer name.
- [x] `%` and `_` in search match literally.
- [x] Sort by date, newest, and popular is deterministic.
- [x] Pagination clamps out-of-range pages.
- [x] Count and page come from one consistent snapshot.
- [x] `getCategoryCounts` matches the unfiltered public scope.
- [x] `getOrganizerEvents` splits upcoming/past correctly.
- [x] It computes counts per status and fill rate.
- [x] Uncapped events report a null fill rate.
- [x] `getRsvpCounts` fills every status, including zeros.
- [x] `getUserWishlist` computes positions in two queries, not N+1.
- [x] `getUserPromotions` returns only promoted GOING rows.
- [x] `getUpcomingRsvps` ordering and limit are correct.
- [x] `getNotificationsPage` paginates and clamps.
- [x] `ensureDueReminders` only creates rows inside the 48-hour window.
- [x] It dedupes within 24 hours.
- [x] It skips opted-out rows.
- [x] It never throws on DB failure.
- [x] `canViewEvent` matrix: public/private × anon/organizer/holder/other.
- [x] `getComments`, `getAttendees`, and `getWishlist` enforce visibility.
- [x] `getAttendeesPage` uses a stable cursor and does not duplicate or skip
      rows across a page boundary.
- [x] Concurrent inserts during cursor paging do not corrupt the export.

### 3.10 Constraints and migrations

- [x] `prisma migrate deploy` succeeds on a fresh branch.
- [x] `prisma migrate status` is clean.
- [x] `Event_maxAttendees_positive` rejects zero and negative values.
- [x] `Comment_body_length` rejects bodies over 1000 characters.
- [x] `(userId, eventId)` uniqueness is enforced.
- [x] `inviteToken` uniqueness is enforced.
- [x] Deleting an event cascades to RSVPs, comments, and event-bound
      notifications.
- [x] Cancellation notifications with `eventId: null` survive event deletion.
- [x] Hot-path indexes exist.
- [x] No script or documented command uses `prisma db push`.

### 3.11 Notification fan-out

- [x] `notifyUsers` writes all supplied rows in one call.
- [x] Empty input is a no-op.
- [x] Promotion notifications are delivered regardless of opt-out.
- [x] Event-update fan-out targets GOING, MAYBE, and WAITLISTED holders.
- [x] It skips opted-out holders.
- [x] It skips the organizer.
- [x] It only fires when title, date, or location changed.
- [x] Cancellation fan-out uses `eventId: null` and includes the title in the
      body.
- [x] Comment fan-out deduplicates recipients.
- [x] Comment fan-out caps at 20 recipients.
- [x] Comment fan-out includes the organizer and excludes the author.
- [x] A notification write failure does not fail the parent action.

---

## Phase 4 — HTTP contract tests

Environment: built app running with the test branch. Use real HTTP requests and
the test DB for setup/assertions.

### 4.1 Calendar route

- [ ] Public event returns 200.
- [ ] Private event returns 200 for the organizer.
- [ ] Private event returns 200 for an RSVP holder.
- [ ] Private event returns 404 for an outsider.
- [ ] Unknown event returns 404.
- [ ] Content type is `text/calendar`.
- [ ] Content disposition names the event.
- [ ] Cache-Control is `no-store`.
- [ ] ICS contains BEGIN/END, UID, DTSTAMP, DTSTART, DTEND, SUMMARY, LOCATION.
- [ ] DTEND is exactly two hours after DTSTART.
- [ ] Special characters in title/location/description are escaped.
- [ ] Injected newlines cannot create new ICS properties.
- [ ] Valid origin produces a URL property; invalid origin omits it.

### 4.2 Attendee CSV route

- [ ] Signed-out request returns 401.
- [ ] Non-organizer returns 404.
- [ ] Unknown event returns 404.
- [ ] Organizer gets 200 and the CSV header.
- [ ] Status, name, joined_at, and checked_in columns are correct.
- [ ] Commas, quotes, and newlines are quoted correctly.
- [ ] `=`, `+`, `-`, and `@` names get a leading apostrophe.
- [ ] Leading tab/CR formula injection is handled or the gap is documented.
- [ ] 1,200 attendees stream across 500-row pages.
- [ ] No attendee is duplicated or skipped across page boundaries.
- [ ] Cache-Control is `private, no-store`.
- [ ] A client abort does not crash the server.
- [ ] Stream failure returns a controlled error, not a partial silent success.

### 4.3 Auth routes

- [ ] Sign-up succeeds with valid input.
- [ ] Sign-up rejects invalid input.
- [ ] Sign-in succeeds and sets a session cookie.
- [ ] Sign-in with a bad password fails without a session.
- [ ] Sign-out clears the session.
- [ ] Protected routes redirect signed-out users to the login URL.
- [ ] Signed-in users can access protected routes.
- [ ] Confirm whether the test auth branch requires email verification.

### 4.4 Headers and security

- [ ] HSTS header is present.
- [ ] `X-Frame-Options: DENY` is present.
- [ ] `X-Content-Type-Options: nosniff` is present.
- [ ] Referrer policy is present.
- [ ] Permissions policy is present.
- [ ] CSP-Report-Only is present on every route.
- [ ] Private event HTML never contains the private title for an outsider.
- [ ] Private event metadata/title uses the not-found title for an outsider.
- [ ] API 404 responses do not disclose whether a private event exists.
- [ ] `Cache-Control` is private/no-store on per-user data.

---

## Phase 5 — Playwright E2E

Environment: production build, real Neon Auth users, seeded domain data.
Chromium plus one mobile viewport. Each spec owns its fixtures and cleans up.

### 5.1 Setup and auth

- [ ] Create organizer, attendee, and outsider users for each run.
- [ ] Save one storage state per role.
- [ ] Sign up through the real UI/API and land signed in.
- [ ] Sign out clears the session.
- [ ] Sign in with valid credentials succeeds.
- [ ] Invalid password shows an error.
- [ ] Signed-out users are redirected from protected routes.
- [ ] Session expiry: clear cookies, click RSVP, land on sign-in.
- [ ] Session expiry shows no "Something went wrong" banner.

### 5.2 Browse and discovery

- [ ] Only public upcoming events appear.
- [ ] Category chips filter and show counts.
- [ ] When filter changes the result set.
- [ ] Sort by date, newest, and popular changes order.
- [ ] Search matches title, description, location, and organizer.
- [ ] `%` and `_` match literally.
- [ ] Pagination shows the correct range and pages.
- [ ] `?page=999` clamps to the last page.
- [ ] No-results state differs from the no-events state.
- [ ] Organizer filter shows the organizer name.
- [ ] Clear all and browser back/forward keep state consistent.

### 5.3 Create and edit events

- [ ] Validation errors show inline.
- [ ] Valid create redirects to the detail page.
- [ ] Public and private events render correctly.
- [ ] Capacity and category persist.
- [ ] Browser-zone wall clock displays correctly.
- [ ] No-JS create falls back to `APP_TIME_ZONE` (optional P1).
- [ ] Title-only edit preserves the displayed time.
- [ ] Title-only edit preserves a legacy null `timeZone`.
- [ ] Editing the date changes the instant, not just the wall clock.
- [ ] Capacity below the GOING count is rejected.
- [ ] Raising capacity promotes waitlisted users.
- [ ] Deleting an event redirects and notifies holders.

### 5.4 RSVP and waitlist

- [ ] GOING, MAYBE, and NOT_GOING can be selected.
- [ ] Switching status updates the counts.
- [ ] Remove RSVP asks for confirmation.
- [ ] A full event shows the wishlist CTA.
- [ ] Joining the wishlist shows the queue position.
- [ ] A second user cancelling promotes the first user.
- [ ] The promoted user sees the "You got in!" banner.
- [ ] Dismiss hides the banner and it stays hidden after reload.
- [ ] Notify toggle persists after reload.
- [ ] Past events are read-only.
- [ ] Ended events reject RSVP attempts.

### 5.5 Wishlist page

- [ ] Positions render correctly.
- [ ] Leaving the wishlist works.
- [ ] Promoted section renders and can be dismissed.
- [ ] Ended wishlist entries show "Event ended" instead of leave.
- [ ] Empty state renders.

### 5.6 Private events and invites

- [ ] Outsider gets 404 for a private event.
- [ ] Organizer can create an invite link.
- [ ] Creating twice returns the same link.
- [ ] Invite preview hides the description for private events.
- [ ] Signed-out invite page prompts sign-in.
- [ ] Accepting the invite creates a GOING RSVP.
- [ ] Accepting a full event creates a WAITLISTED RSVP.
- [ ] Regenerating invalidates the old link.
- [ ] Revoking invalidates the link.
- [ ] The host is redirected away from the invite page.
- [ ] Two tabs creating a link concurrently return the same token.

### 5.7 Comments

- [ ] Add a comment and see it appear with the author name.
- [ ] Comment count updates.
- [ ] 51 seeded comments show "Comments (51)" while 50 render.
- [ ] Delete your own comment.
- [ ] Organizer can delete any comment.
- [ ] Other users cannot delete someone else's comment.
- [ ] Past events are read-only.
- [ ] The sixth rapid comment shows the rate-limit message.

### 5.8 Organizer dashboard

- [ ] Stats show upcoming, going, wishlisted, past, and average fill.
- [ ] Upcoming/past/all views work.
- [ ] Search filters the dashboard.
- [ ] Sort by date, fill, and newest works.
- [ ] Empty states render for each view.
- [ ] A non-organizer does not see another organizer's events.
- [ ] The CSV link points at the export route.

### 5.9 Notifications

- [ ] Promotion notifications appear.
- [ ] Event-update notifications appear.
- [ ] Cancellation notifications appear with no dead event link.
- [ ] Comment notifications appear.
- [ ] Reminder notifications appear for an event inside 48 hours.
- [ ] Unread bell count matches the notifications page.
- [ ] Mark one read updates the count.
- [ ] Mark all read clears the count.
- [ ] 57 notifications paginate 20 per page.
- [ ] `?page=999` clamps.
- [ ] Marking a row on page 2 keeps the page.

### 5.10 Calendar links

- [ ] The ICS link downloads a valid file.
- [ ] The Google Calendar link contains the expected event parameters.

### 5.11 Security and authorization matrix

- [ ] Outsider cannot edit an event.
- [ ] Outsider cannot delete an event.
- [ ] Outsider cannot check in attendees.
- [ ] Outsider cannot export attendees.
- [ ] Outsider cannot read a private event.
- [ ] Users cannot read another user's notifications.
- [ ] Stored XSS in an event title/description/comment does not execute.
- [ ] CSV injection payloads are neutralized in the export.
- [ ] Two tabs checking in the same attendee store one timestamp.
- [ ] Two tabs undoing the same check-in leave both fields null.

### 5.12 Resilience and accessibility

- [ ] DB outage renders the error boundary, not a raw 500.
- [ ] The error reference digest is shown.
- [ ] The server log contains one correlatable `[request error]` line.
- [ ] Restoring the DB and clicking "Try again" recovers the page.
- [ ] Axe scan on home, events, detail, create, dashboard, wishlist,
      notifications, and auth pages reports no serious/critical issues.
- [ ] Filters, RSVP controls, and forms are keyboard navigable.
- [ ] Async errors are announced (`role="alert"` or live region).
- [ ] Mobile viewport has no horizontal overflow.
- [ ] Mobile nav, filters, and cards remain usable.

### 5.13 External flows

- [ ] Google sign-in click starts the provider redirect; abort before consent.
- [ ] Document that the full Google consent flow remains manual.
- [ ] Optional: run Firefox/WebKit if cross-browser support is required.

---

## Phase 6 — Non-functional and operations

### 6.1 Fault injection

- [ ] Rate limiter fails open on DB error.
- [ ] Promotion notification failure does not roll back promotion.
- [ ] Cancellation notification failure does not fail the cancel.
- [ ] Comment notification failure does not fail the comment.
- [ ] Check-in returns `{ok:false}` rather than throwing on DB failure.
- [ ] Reminder creation never throws into the page render.
- [ ] Event update notification failure does not fail the edit.

### 6.2 Performance smoke (optional, P2)

- [ ] Browse page with 500 events responds within an agreed p95.
- [ ] RSVP mutation responds within an agreed p95 on the test branch.
- [ ] Confirm no N+1 in wishlist position calculation.
- [ ] Confirm the CSV export streams without buffering the whole file.

### 6.3 Migration and deployment safety

- [ ] Fresh-branch migration apply is part of CI.
- [ ] Migration drift check is part of CI.
- [ ] CHECK constraints are covered by tests.
- [ ] Cascades are covered by tests.
- [ ] `prisma db push` is forbidden in scripts and documentation.
- [ ] Test DB branch deletion runs even when tests fail.

### 6.4 Documentation

- [x] `TESTING.md` explains every command.
- [x] `TESTING.md` explains the ephemeral branch lifecycle.
- [x] `TESTING.md` explains how to write a regression test.
- [x] `TESTING.md` lists manual-only checks.
- [x] README links to `TESTING.md` (and to this plan).

---

## CI pipeline checklist

- [ ] Static job: install, typecheck, lint, build with valid test env values.
- [ ] Unit + component job: `npm test`, no DB or network.
- [ ] DB integration job: create branch, migrate, run `test:db`, always delete
      branch.
- [ ] HTTP contract job: build/start and run `test:http`.
- [ ] E2E job: create branch, create auth users, build/start, run Playwright
      Chromium + mobile, upload traces/report.
- [ ] Required checks on PR: static, unit/component, DB integration, focused
      E2E smoke.
- [ ] Full E2E on main/nightly.
- [ ] Nightly: higher concurrency rounds, axe, cross-browser, performance.
- [ ] Upload coverage and JUnit results.
- [ ] Fail the run if coverage drops below the agreed thresholds.
- [ ] Never expose database credentials in logs.
- [ ] Cache dependencies and Next build artifacts where safe.

Coverage targets:
- [ ] `src/lib/time.ts`, `event-validation.ts`, `discovery.ts`, `calendar.ts`
      at 90%+ lines.
- [ ] `src/lib/rsvp.ts`, `rate-limit.ts`, `notifications.ts`, query cores at
      80%+.
- [ ] No coverage target for generated Prisma code or pages; E2E covers pages.

---

## Traceability to the old manual QA checklist

- [ ] Session-expiry redirect: E2E auth + `RsvpControls` redirect-digest test.
- [ ] DB outage boundary: resilience job + manual retry confirmation.
- [ ] Past-date RSVP: DB core tests + E2E past event.
- [ ] Wall clock stability: unit time tests + DB edit tests + E2E timezone.
- [ ] Rate-limit messages: DB counter tests + E2E comment/event-create.
- [x] Existing probes: ported to `tests/db` (and `tests/unit` for the read-only
      ones) with the same invariants.
- [ ] RateLimit GC: handler tests + script tests + SQL predicate test.
- [ ] Invite/check-in atomicity: DB concurrency + E2E parallel tabs.
- [ ] Pagination/CSV/search/comments/HSTS: HTTP contract + E2E + header tests.

After Phase 6, the manual checklist should contain only external/manual items
(Google OAuth, production deployment, real email delivery, and any browser
matrix that CI does not cover).

---

## Delivery phases

- [x] **Phase 0 — Harness** (1–2 days): tooling, configs, scripts, DB lifecycle,
      guards, factories, seams, documentation, ported probes.
- [x] **Phase 1 — Unit** (2–3 days): pure modules, property tests where useful
      (optional property tests not added).
- [x] **Phase 2 — Component** (1–2 days): client state machines and error paths.
      Complete for every component that exists in `src/components/` and `src/app/`;
      tests for components not yet built (none remain — all Phase 2-listed
      components now exist) are covered. `data-pending` on filters is left
      unchecked with a note (not assertable with a mocked router transition;
      covered by Playwright in Phase 5).
- [x] **Phase 3 — DB integration** (3–4 days): RSVP/waitlist, rate limits,
      invites, check-in, queries, constraints, notifications, jobs.
- [ ] **Phase 4 — HTTP contract** (1–2 days): CSV, ICS, auth routes, headers,
      authz.
- [ ] **Phase 5 — E2E** (3–4 days): auth, browse, lifecycle, RSVP, invites,
      comments, dashboard, notifications, security, a11y, resilience.
- [ ] **Phase 6 — Hardening** (1–2 days): flake quarantine, coverage,
      documentation, retire obsolete scripts.

Approximate total: 2–3 weeks for one engineer, with useful coverage landing
after Phases 0–1.

---

## Definition of done

- [x] `npm run verify` remains green.
- [x] `npm test` runs unit + component suites with no DB, env, or network.
- [x] `npm run test:db` runs on an ephemeral branch, applies migrations, proves
      all invariants, cleans up, and refuses production. Verified end to end on
      2026-10-27 (2 files / 14 tests on a fresh branch).
- [ ] `npm run test:http` covers CSV, ICS, auth routes, and security headers.
- [ ] `npm run test:e2e` covers the P0 journeys deterministically in Chromium
      and one mobile viewport, with traces on failure. Infrastructure verified
      (2 Playwright projects run green); only the smoke spec exists so far.
- [ ] Every bug found gets a regression test at the lowest layer that catches it.
- [ ] Manual QA is reduced to external/manual-only checks.
- [ ] CI enforces the suite; nightly runs the expensive jobs.
- [x] Test DB guard prints hosts only, never credentials, and cannot target
      production.
- [x] `TESTING.md` is accurate enough for a new contributor to run everything.

---

## Risks and open decisions

- [x] Confirm Neon API access for CI: project id, `NEON_API_KEY`, and
      create/delete-branch permission. Verified locally on 2026-10-27; CI secrets
      are still to be configured.
- [x] Confirm whether Neon Auth is branch-scoped. It is: every branch gets its
      own `base_url` / `jwks_url`, so authenticated E2E runs on ephemeral
      branches (no long-lived staging branch needed).
- [x] Confirm whether test users need email verification and whether the test
      branch can auto-confirm them. Sign-up returns a session immediately; no
      verification step is required.
- [x] Prefer a schema-only `test-base` branch to avoid copying production PII.
      Not available for this project (Neon Auth's legacy web access roles block
      every schema-only init source), so the base is a one-time copy-on-write
      branch that is scrubbed and verified empty before use.
- [ ] Decide PR E2E smoke scope versus full nightly to control cost.
- [ ] Decide whether Firefox/WebKit are required.
- [ ] Confirm coverage thresholds.
- [ ] Confirm the CI provider (GitHub Actions or other).
- [ ] Confirm whether a production/preview smoke test is allowed.
- [ ] Confirm the test-data policy for the Neon Auth branch.
