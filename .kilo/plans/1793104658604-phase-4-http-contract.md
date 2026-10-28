# Phase 4 Implementation Plan — HTTP Contract Tests

**Goal:** Implement every Phase 4 item in `testing_plan.md` (sections 4.1–4.4) against a real, built Next.js app backed by an ephemeral Neon branch. Tests make real HTTP requests via `fetch` and assert status codes, headers, and response bodies (ICS bytes, CSV rows).

**Plan file:** `.kilo/plans/1793104658604-phase-4-http-contract.md` (this file).

---

## Decisions (resolved, do not re-open)

| Decision | Rationale |
|---|---|
| **Vitest `http` project runs against a started app** | `vitest.config.mts:53-62` already defines the `http` project (node env, `tests/http/**`, `tests/setup/db.ts` safety guard, no tests yet). It does NOT start a server — the app must be running already (build + start on a port). |
| **App started via child process, not vitest webServer** | Vitest has no built-in `webServer`. A small helper spawns `next start` (after `next build`) on a port from `.env.test` `TEST_BASE_URL`, waits for readiness, kills it on teardown. CI can also start `next start` externally before `test:http`. |
| **`TEST_BASE_URL` drives the base URL** | `.env.test` already sets `TEST_BASE_URL="http://localhost:3100"` (TESTING.md:126). Tests read `process.env.TEST_BASE_URL ?? 'http://localhost:3100'`. |
| **Better Auth email endpoints via JSON POST** | Auth routes are `/api/auth/[...path]` (NextAuth-style catch-all handled by `auth.handler()`). Sign-up: POST `/api/auth/email/sign-up`, Sign-in: POST `/api/auth/email/sign-in`, Sign-out: POST `/api/auth/sign-out`. Better Auth sets HTTP-only `session_token` cookie; tests extract `Set-Cookie` and forward with `credentials: 'include'`. |
| **Cookie forwarded manually (no cookie jar)** | Node `fetch` has no cookie jar. A small `request()` helper extracts `Set-Cookie` headers from responses and forwards them on subsequent calls. |
| **DB setup via Phase 3 cores/factories** | `tests/support/factories.ts` (`makeEvent`, `makeRsvp`, `uniqueId`, `futureDate`) + DB cores (`upsertRsvpCore`, `cancelRsvpCore`, `checkInAttendeeCore`) create rows before HTTP requests. `resetDomainTables()` in `beforeEach`. |
| **One test file per Phase 4 section** | `tests/http/calendar.test.ts`, `attendees.test.ts`, `auth.test.ts`, `headers.test.ts`. |

---

## Infrastructure details

### App server lifecycle

Create `tests/http/helpers/server.ts`:

- `startApp()`: checks `TEST_BASE_URL` host/port. If a process is already listening on that port (e.g. CI started `next start` externally), reuse it. Otherwise spawn `next start -- -p ${port}` as a detached child process (`NODE_ENV=test`, `.env.test` loaded via `dotenv`), poll `GET /` until 200 (up to 30s), return `{ port, childProcess | null }`.
- `stopApp()`: kill the child process if we started it.
- `isPortReady(host, port)`: `fetch` to root path with short timeout.

Build step: `next build` must run before `next start`. In CI: `npm run build` then start `next start -- -p 3100` in background, set `TEST_BASE_URL`, run `npm run test:http`, kill. Locally the helper does build+start.

### HTTP client with cookies

Create `tests/http/helpers/client.ts`:

- `request(input, init)`: wrapper around global `fetch`. Extracts `Set-Cookie` from response, stores in a module-level cookie map. Forwards stored cookies as `Cookie` header on subsequent requests to the same host.
- `get(url)`, `post(url, body)`: convenience wrappers.
- `authCookie()`: returns current `session_token` cookie value (for assertions).

### Auth helpers

Create `tests/http/helpers/auth.ts`:

- `signUp(email, name, password)`: POST JSON to `/api/auth/email/sign-up`, returns response + cookies.
- `signIn(email, password)`: POST JSON to `/api/auth/email/sign-in`, returns response + cookies.
- `signOut()`: POST to `/api/auth/sign-out`.
- `createUserAndSignIn(...)`: signs up then signs in, returns authenticated `request` with cookies forwarded.

Note: Better Auth email sign-up may require email verification depending on branch provisioning defaults (TESTING.md:302-304). Test only what the branch actually supports; if verification is required, sign-up test asserts the redirect/verification step rather than immediate session.

---

## Ordered task list

### Task 1 — HTTP test infrastructure
Files: `tests/http/helpers/server.ts` (new), `tests/http/helpers/client.ts` (new), `tests/http/helpers/auth.ts` (new)

1. Create `server.ts`: `startApp()` / `stopApp()` / `isPortReady()`. Reuse existing server if port is open; otherwise spawn `next start`.
2. Create `client.ts`: `request()` with cookie jar, `get()` / `post()` wrappers.
3. Create `auth.ts`: `signUp()`, `signIn()`, `signOut()`, `createUserAndSignIn()`.
4. `npm run typecheck`, `npm run lint tests/http/helpers/*`.

### Task 2 — `tests/http/calendar.test.ts` (4.1 Calendar route)
`beforeEach: resetDomainTables()`. Use `makeEvent`, `makeRsvp`, `upsertRsvpCore`.

- Public event returns 200 with `text/calendar`, `Content-Disposition: attachment; filename="event-<id>.ics"`, `Cache-Control: no-store`.
- Private event returns 200 for organizer.
- Private event returns 200 for RSVP holder (GOING/MAYBE/WAITLISTED/NOT_GOING).
- Private event returns 404 for outsider (no session / other user).
- Unknown event returns 404.
- ICS body contains `BEGIN:VCALENDAR`, `END:VCALENDAR`, `UID:`, `DTSTAMP:`, `DTSTART:`, `DTEND:`, `SUMMARY:`, `LOCATION:`.
- `DTEND` is exactly 2 hours after `DTSTART` (parse ICS lines, compare).
- Special chars in title/location/description are escaped (`\`, `;`, `,`, newlines → `\n`).
- Injected newlines cannot create new ICS properties (title with `\r\nBEGIN:VALARM` does not create extra property).
- Valid origin (`TEST_BASE_URL`) produces `URL:` property; invalid/omitted origin omits `URL:`.

### Task 3 — `tests/http/attendees.test.ts` (4.2 Attendee CSV route)
`beforeEach: resetDomainTables()`. Use `makeEvent`, `makeRsvp`, `checkInAttendeeCore`, `createUserAndSignIn`.

- Signed-out request returns 401.
- Non-organizer returns 404.
- Unknown event returns 404.
- Organizer gets 200 with header `status,name,joined_at,checked_in`.
- Columns correct: status (GOING/MAYBE/etc), attendeeName, joined_at (createdAt ISO), checked_in (checkedInAt ISO or empty).
- Commas/quotes/newlines in names are quoted correctly (double-quoted, quotes doubled).
- `=`, `+`, `-`, `@` prefix names get leading apostrophe (formula injection).
- Leading tab/CR formula injection is handled or gap documented (assert cell starts with `'` or is quoted).
- 1,200 attendees stream across 500-row pages: create 1,200 RSVPs, request CSV, assert total rows = 1,200 + header, no duplicates/skips (unique ids, contiguous).
- `Cache-Control: private, no-store`.
- Client abort does not crash server: abort mid-stream, assert subsequent requests still work.
- Stream failure returns controlled error (force DB error, assert non-500 or graceful handling).

### Task 4 — `tests/http/auth.test.ts` (4.3 Auth routes)
Uses `createUserAndSignIn`, `signUp`, `signIn`, `signOut`.

- Sign-up succeeds with valid input (200/201, session cookie set).
- Sign-up rejects invalid input (missing email/password, short password → error, no cookie).
- Sign-in succeeds and sets session cookie (200, `Set-Cookie` contains `session_token`).
- Sign-in with bad password fails without session (4xx, no `session_token` cookie).
- Sign-out clears the session (200, subsequent request to protected route gets 401/redirect).
- Protected routes redirect signed-out users to login URL (e.g. GET `/my-events` → 307/302 to `/auth/sign-in`).
- Signed-in users can access protected routes (GET `/my-events` → 200).
- Confirm whether test auth branch requires email verification: if sign-up returns a verification-required response, assert that; if immediate session, assert session cookie. (Branch provisioning default — document in test.)

### Task 5 — `tests/http/headers.test.ts` (4.4 Headers and security)
Hit multiple routes (GET `/`, GET `/events`, GET `/api/events/<id>/calendar`, GET `/api/events/<id>/attendees` signed-in).

- `Strict-Transport-Security` present (`max-age=63072000; includeSubDomains`).
- `X-Frame-Options: DENY` present.
- `X-Content-Type-Options: nosniff` present.
- `Referrer-Policy` present (`strict-origin-when-cross-origin`).
- `Permissions-Policy` present.
- `Content-Security-Policy-Report-Only` present on every route.
- Private event HTML never contains private title for outsider (GET event detail page signed-out → body does not include event title).
- Private event metadata/title uses not-found title for outsider (404 page shows generic title, not event title).

### Task 6 — Validation
- `npm run typecheck`
- `npm run lint tests/http/**`
- `npm run test:http` — requires `.env.test` (via `npm run db:test:up`) and a running app (`npm run build` + `npm run start -- -p 3100` or helper-managed). Cannot run locally without `NEON_API_KEY`/`NEON_PROJECT_ID` — run in CI or after user provisions a branch.

---

## Risks & notes

- **Better Auth email verification**: The test branch is provisioned with provider defaults. If email verification is required, sign-up won't set a session cookie immediately. The test must handle both paths (assert verification redirect OR assert session).
- **`next build` takes time**: `startApp()` should run `next build` first if `.next` is stale, or CI should pre-build. Build output must use `.env.test` variables (not `.env` production auth).
- **Cookie forwarding**: Manual cookie jar must handle multiple `Set-Cookie` headers and path/domain scoping simply (same host, forward all).
- **CSV streaming test with 1,200 rows**: Creating 1,200 RSVPs via `makeRsvp` in a loop is slow but acceptable (~seconds). Use `Promise.all` with bounded concurrency.
- **`getAttendeesPage` cursor paging**: The CSV route cursors by `id`. Test that 1,200 rows produce exactly 1,200 data rows across pages with no gaps/duplicates.
- **Port conflicts**: If `TEST_BASE_URL` port is already in use by another process, `startApp()` reuses it (assumes it's our app). Add a health check (`GET /` returns 200) before reusing.
- **`NODE_ENV=test`**: Must not be `production` (safety guard). Set explicitly when spawning `next start`.
- **DB safety guard runs via `tests/setup/db.ts`**: `TEST_DB_ALLOW=1` and `.env.test` required, same as DB project.

---

## Out of scope for Phase 4 (explicitly)
- E2E browser tests (Phase 5, Playwright).
- Google OAuth consent flow (manual-only per TESTING.md).
- Real email delivery (manual-only).
- CI pipeline wiring (branch deletion on failure, coverage thresholds).
- CI starting the app externally (helper manages it, but CI script may pre-start).
