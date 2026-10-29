I read testing_plan.md (the "Testing.md" file is TESTING.md in this repo) and the existing E2E/HTTP/DB harness. Here's the review and the implementation plan.
Where Phase 5 stands
Phase 5 is the only layer that still has zero real coverage: tests/e2e/ contains only smoke.spec.ts, while playwright.config.ts already has two projects, a production-build webServer, traces, and a skip-if-no-branch rule. Everything else (Phases 0–4) is implemented and green.
The Phase 5 checklist is broad and mostly maps to real UI. But it is not implementable as written until 5 infrastructure gaps are closed, and it misses several journeys that the code actually supports.

1. Infrastructure gaps that block Phase 5 (P0)

# Gap Evidence Recommendation

1 No E2E data isolation policy. fullyParallel: true, no cleanup, no seeding helper. Browse/pagination/notification-count tests need a known dataset, but specs run in parallel. playwright.config.ts; no tests/e2e/support/db.ts Give E2E exclusive ownership of the branch: truncate Event/RSVP/Comment/Notification/RateLimit in global setup and teardown; run workers: 1 initially. test:all already runs layers sequentially. Document that E2E and test:http must not share a branch concurrently.
2 No auth roster / storage states. 0.2, 0.6 auth helpers are still unchecked, and Phase 5.1 only says "create users". tests/http/helpers/roster.ts exists; no E2E equivalent Add a Playwright setup project (tests/e2e/auth.setup.ts) that signs up organizer/attendee/outsider through the real UI and saves tests/.auth/{role}.json via context.storageState(). tests/.auth/ is already gitignored. Handle Better Auth's 3-per-10s limit with sequential creation + one retry.
3 No DB seeding from the Playwright process. E2E needs 13+ events, 57 notifications, check-in rows, and past/private events; creating all via UI is slow and hits rate limits. No E2E support db module Add tests/e2e/support/db.ts that loads .env.test before importing Prisma, runs assertTestDatabaseSafety(), reuses tests/support/factories.ts, and exposes seedEvent/seedRsvp/seedNotifications/clearRateLimits. Verify Playwright resolves @/… paths; if not, use relative imports.
4 Shared rate-limit budgets leak between specs. eventCreate 10/h, comment 5/min, rsvp 30/min, eventEdit 10/min are keyed by user id. A reused organizer can hit the limit mid-suite. src/lib/rate-limit.ts Seed fixtures through Prisma by default; reserve UI mutations for the spec that tests them. Add clearRateLimits(userId) and call it for the spec's users in beforeAll. Use a fresh UI-created user for sign-up/rate-limit specs.
5 No browser timezone control. "Browser-zone wall clock displays correctly" is meaningless if the browser runs in the host zone. playwright.config.ts has no timezoneId Set test.use({ timezoneId: 'America/New_York' }) (and locale: 'en-US') in the create/edit timezone spec; APP_TIME_ZONE is Europe/Berlin, so the two must visibly differ. Keep a default-zone spec too.
6 Every spec runs on desktop and Pixel 7, doubling runtime for journeys that are viewport-independent. projects list Tag mobile-only tests @mobile; mobile project runs @mobile + a small smoke set. Keep full journeys desktop-only.
7 Server-log assertions are impossible today. webServer output is not programmatically accessible, yet 5.12 requires one [request error] line. playwright.config.ts Keep webServer but wrap the start command in scripts/start-test-app.ts that tees stdout/stderr to test-results/server.log, or reuse tests/http/helpers/server.ts with a logFile option.
8 "DB outage → error boundary → restore DB → Try again" has no mechanism and cannot be done against the single running server. Phase 5.12 Recommended: an opt-in db-down project (E2E_DB_DOWN=1) that starts a second server on another port against a deliberately broken DATABASE_URL, reusing the same .next build and the same localhost storage states. Assert the boundary + digest + log line. Move "restore and recover" to component coverage (ErrorFallback retry is already tested) + manual-only; don't claim it in E2E.
9 Port collision / stale-server reuse. E2E and HTTP both use localhost:3100 with reuseExistingServer: !CI. E2E can silently attach to a stale build or a dev server. configs Give E2E its own port (e.g. localhost:3200) via TEST_E2E_BASE_URL (keep TEST_BASE_URL for HTTP), and fail if the reused server's build is older than .next.
10 data-pending (2.4) is left unchecked but never actually assigned to Phase 5. plan 2.4 / delivery note Either add a Playwright test using a delayed RSC response (page.route + delay) and assert [data-pending], or explicitly close it as "not observable; attribute is cosmetic" and remove it from the DoD. Don't leave it dangling.
11 Missing page coverage: not-found, global-error, notification/wishlist/dashboard empty states, unknown event id, unknown invite. routes Add unknown-event/unknown-invite to browse/invite specs; keep global-error manual (layout crash cannot be triggered from a page).
12 0.5 E2E teardown policy is still unchecked; Phase 5 says "each spec cleans up" but no mechanism. plan 0.5 Resolve via branch-wide truncate at teardown + branch deletion in CI. Document explicitly in TESTING.md. 2. Missing behaviour coverage inside Phase 5
These are real app behaviours the current Phase 5 text doesn't test. Grouped by section; add them to the checklist.
5.1 Auth

- Signed-out matrix for all protected routes (/account, /events/new, /events/:id/edit, /wishlist, /my-events, /notifications), not just "protected routes".
- After a protected-route redirect and sign-in, document where the user lands. SignInPage always router.push('/') and the middleware has no next param — the deep link is lost. Decide: accept and assert, or add a callback URL (product change, not test-only).
- Navbar signed-in/out link set and unread bell label.
- Sign-up validation: weak password / duplicate email visible inline (HTTP covers the API; this covers the form).
  5.2 Browse
- Private and past events are absent from browse and search (currently only "public upcoming").
- Unknown event id → generic not-found page.
- Category count badge values are global/unfiltered (assert they don't change when a category is active).
- Organizer filter chip By <name> and its removal.
- Combined filter + page 2 retains filters; changing a filter resets to page 1 (UI level).
- Capped/full event card shows "Full".
- data-pending (see infra #10).
  5.3 Create/edit
- Signed-out create/edit redirect to sign-in (edit is middleware+page; create is the form).
- Create with a past date → server-side inline error; empty fields → browser validation.
- eventCreate rate limit: seed RateLimit("eventCreate:<userId>", count=10) and assert the message (don't create 10 events).
- Non-organizer edit redirects to /events (not 404).
- Delete: confirm/cancel paths; redirect to /events; holder receives EVENT_CANCELLED with no "View event" link.
- Public→private edit removes it from browse; private→public adds it.
- "Capacity below GOING count" shows the inline error and retains form values.
- Timezone: title-only edit keeps displayed time and legacy null timeZone stays null (assert DB); date edit changes the instant; browser-zone spec with timezoneId.
- Browser-zone/no-JS item is optional P1 — mark it optional or drop.
  5.4 RSVP / waitlist
- Notify opt-out suppresses a later EVENT_UPDATED (UI + notifications page).
- Promotion banner dismissal is consistent between detail page and /wishlist (both read promotedAt).
- RSVPed attendee's name appears in the organizer roster.
- Concurrent last-seat RSVP from two browser contexts (P1; DB already proves the invariant).
- Rephrase "Ended events reject RSVP attempts": the UI has no controls. Either call the action directly (brittle) or assert read-only + rely on DB for rejection.
  5.5 Wishlist
- Promotion moves the row out of "Waiting for a spot" into "You got in!" and Dismiss persists after reload.
- Leave wishlist confirm/decline.
- Position updates when someone ahead leaves (two users).
  5.6 Invites
- Signed-out → sign-in → invite token is preserved (currently the sign-in redirect drops /invite/<token>; this is the same deep-link decision as 5.1).
- Accept while already GOING is idempotent (no duplicate row, no error).
- Past event invite shows "This event has ended".
- Private description is absent from the raw HTML, not just visually hidden.
- Invite panel is organizer-only; an outsider on a public event sees no Attendees/Export/Wishlist/Invite panels.
- Old link after regenerate/revoke shows "Invite not found".
- Two-tab concurrent create returns the same token (UI-level; DB covers the concurrency).
  5.7 Comments
- Comment appears without a manual reload (verify revalidatePath actually refreshes the list).
- Signed-out users see comments and get the sign-in prompt instead of the form.
- Organizer badge renders; author and organizer can delete, other users cannot.
- Rate limit is per-user: a second user can still comment while the first is limited.
- Stored XSS via DB-seeded authorName (see security).
  5.8 Dashboard
- Check-in / undo journey (currently only inside 5.11's two-tab case): progress bar, checked-in count, idempotence.
- CSV download from the dashboard actually starts a download; outsider never sees the link.
- Uncapped event shows Avg fill —.
- view=upcoming|past|all, default upcoming, tab counts.
- Another signed-in user sees only their own (empty) dashboard — the current wording "does not see another organizer's events" is not a real cross-user view.
- Description-only edit does not notify holders (the diff rule is currently DB-only).
  5.9 Notifications
- "Coming up" widget is not in Phase 5 at all: next RSVPs, Starts … labels, hidden when empty.
- Reminder generation requires opening /notifications and reloading: the page fetches getNotificationsPage in parallel with the widget that calls ensureDueReminders, so the REMINDER may not be in the first HTML. Assert after reload; assert the 24h dedupe on a second reload.
- All five type labels render (PROMOTION/EVENT_UPDATED/EVENT_CANCELLED/COMMENT/REMINDER).
- Bell aria-label count matches the page; mark-one/mark-all updates the bell (verify whether revalidatePath('/notifications') refreshes the root-layout bell).
- "View event" navigates; cancellation rows have no link.
- Mark-all-read is disabled at zero unread.
- Scoping test at DB level inside E2E: attacker's "mark all read" must not alter the victim's rows.
  5.10 Calendar
- Actually parse the downloaded .ics: CRLF, BEGIN:VEVENT, UID, DTSTART, DTEND = +2h, SUMMARY.
- Google link href contains the encoded event parameters.
  5.11 Security
- Non-organizer sees no roster, CSV export, wishlist panel, or invite panel.
- Private title/description absent from rendered HTML (HTTP covers headers; this covers the DOM).
- XSS payload (<img src=x onerror=…>) in title, description, comment body, and seeded author name does not execute (set a window flag + dialog listener).
- Signed-out matrix (same as 5.1).
- CSV injection: assert once via the downloaded file (HTTP already covers exact bytes).
- Notification IDOR + two-tab check-in/undo (present) + two-tab RSVP race.
  5.12 Resilience/a11y
- Error boundary via the db-down server project; digest shown; one log line.
- "Try again" re-issues the request (even if it fails again); recovery is manual.
- Axe: home, browse, detail (public + private as holder), create, dashboard, wishlist, notifications, sign-in/sign-up. Run on chromium only.
- Keyboard: filter chips/selects, RSVP group, forms, mobile drawer (Escape, focus return, aria-expanded).
- Async errors announced: force the comment rate limit and assert role="alert".
- Mobile: no horizontal overflow on all main pages; drawer open/close; filters and cards usable.
  5.13 External
- Click Google sign-in and abort at the provider request; document the manual consent flow.

3. Gaps in other phases that Phase 5 must absorb (or move)
   Plan item Where it belongs
   0.2 auth.setup.ts project, 0.5 E2E teardown, 0.6 auth helpers Phase 5 infra — check them as part of this work.
   2.4 data-pending Phase 5, or close it explicitly (see infra #10).
   3.8 manual cleanup/backfill script tests (5 items) Phase 6, not E2E.
   3.9 when-filter today/week/month app-zone day boundaries DB test, not E2E. Currently unassigned; add to Phase 6.
   4.2 CSV stream failure on server error Phase 6 fault injection (already noted).
   Traceability "rate-limit messages: E2E comment + event-create" Add the event-create rate-limit test here.
   Traceability "invite/check-in atomicity" Check-in is present; invite atomicity is DB-only — note it.
   Definition of done "only smoke exists" Update as specs land.
   Trim duplication while doing this. Phases 1–4 already prove %/_ escaping, pagination math, getComments limits, notification pagination, CSV bytes, and ICS structure. E2E should assert one user-visible case each, not every permutation. Doing so takes the ~112 checkboxes down to roughly 80 real tests.
4. Implementation plan
   Step 0 — Decisions and spike (0.5 day)
5. Confirm isolation: branch-exclusive E2E, workers: 1, truncate at setup/teardown. Revisit per-worker branches later if runtime hurts.
6. Confirm mobile scope: @mobile only, not the full suite.
7. Confirm DB-down approach: second server + broken DB URL (recommended) vs SQL statement_timeout (less deterministic).
8. Spike: create one user through the UI, save storageState, open a new context with it, and verify protected pages render signed in. Also verify Playwright resolves @/… imports; fall back to relative imports if not.
9. Confirm the deep-link behavior (sign-in/invite) is acceptable or a product fix is needed.
   Step 1 — Harness (1 day)
   New/changed files:
   playwright.config.ts # setup project, dependencies, @mobile/@smoke/@dbdown, E2E port, workers:1
   scripts/start-test-app.ts # optional: tee server output to test-results/server.log
   tests/e2e/auth.setup.ts # 3 role users -> tests/.auth/*.json
   tests/e2e/support/env.ts # safety guard, URLs, roles
   tests/e2e/support/auth.ts # unique emails, sign-in helpers, storage paths
   tests/e2e/support/db.ts # prisma, assert guard, truncate, seed/cleanup helpers
   tests/e2e/support/fixtures.ts # test.extend: role page/context, seeded event, runId
   tests/e2e/support/axe.ts # AxeBuilder wrapper (serious/critical)
   tests/e2e/global-setup.ts # truncate + optional db-down server start
   tests/e2e/global-teardown.ts # truncate + disconnect + stop server
   Rules encoded in the harness:

- No spec signs up in beforeEach.
- Fixtures default to Prisma seeding; UI only where the UI is the thing under test.
- Each spec clears its users' rate limits in beforeAll.
- Global setup truncates the domain tables once; teardown truncates again and asserts zero rows.
- Never print credentials; server log is written to a gitignored artifact.
  Step 2 — Specs, in dependency order (2.5 days)
  Order Spec Covers
  1 auth.spec.ts 5.1 + deep-link decision + expired-session RSVP
  2 browse.spec.ts 5.2 + not-found + empty/no-results; seed one dataset, test.describe.configure({ mode: 'serial' })
  3 events.spec.ts 5.3 create/edit/delete/capacity/timezone/rate-limit
  4 rsvp.spec.ts 5.4 + two-context promotion flow + notify opt-out
  5 wishlist.spec.ts 5.5
  6 invites.spec.ts 5.6 + two-context accept/revoke/regenerate
  7 comments.spec.ts 5.7 + per-user rate limit
  8 dashboard.spec.ts 5.8 + check-in/undo + CSV download
  9 notifications.spec.ts 5.9 + Coming up + reminder reload + bell
  10 calendar.spec.ts 5.10 downloaded ICS + Google href
  11 security.spec.ts 5.11 matrix, XSS, CSV, notification scoping, two-tab races
  12 a11y.spec.ts axe pages (chromium only)
  13 responsive.spec.ts mobile-only overflow/drawer/filters (@mobile)
  14 resilience.spec.ts @dbdown error boundary + digest + log
  15 external.spec.ts Google redirect abort + manual note
  Tagging: @smoke on ~10–12 critical journeys for PRs; @mobile for responsive; @a11y; @dbdown. Add scripts test:e2e:smoke and test:e2e:mobile.
  Step 3 — Hardening and docs (0.5 day)
- Run the suite twice on a fresh branch; fix flakes; no waitForTimeout except documented provider waits.
- Add assertions that the run leaves the domain tables empty.
- Update TESTING.md: E2E roster, storage states, seeding/truncation policy, ports, tags, db-down project, log artifact, manual items.
- Update testing_plan.md: check 5.x items, 0.2/0.5/0.6, 2.4, and the "only smoke exists" DoD; move the script/stream/when-filter gaps to Phase 6.
- Note for CI: E2E job needs branch + build + roster + traces; reuse the HTTP global-setup pattern.
  Acceptance criteria
- npm run db:test:up -- --force && npm run test:e2e is green twice on an empty branch, desktop + mobile, with no leftovers.
- Every 5.1–5.13 item is checked or annotated with a reason (same style as Phases 1–4).
- Smoke subset under ~3 min; full desktop under ~10 min with workers: 1.
- Traces/screenshots/videos on failure; no secrets in artifacts.
- No production code changes except, if approved, a callback-URL fix for sign-in/invite and a test-only app-start wrapper.
  Risks: Better Auth rate limits during setup; serial runtime; Neon latency flake; Next streaming 200s (private detail); reminder/bell refresh timing; axe may surface real accessibility defects that need fixes, not just tests.
  Decisions I need from you

1. Isolation: branch-exclusive E2E + workers: 1 (recommended), or invest in per-worker data isolation now?
2. Mobile: @mobile subset (recommended) or run all specs on Pixel 7?
3. DB outage: second server with a broken DB URL (recommended) or SQL fault injection? And is "restore + Try again" acceptable as manual-only?
4. Deep links: keep current behavior (sign-in always lands on /) and test it, or fix callback URLs as part of Phase 5?
   Once you confirm these, I can write the plan file or switch to implementation when you move to the build agent.

Decisions made:

1. Isolation: branch-exclusive E2E + workers: 1
2. Mobile: @mobile subset (recommended)
3. DB outage: second server with a broken DB URL (recommended) and "restore + Try again"
4. Deep links: or fix callback URLs as part of Phase 5?
