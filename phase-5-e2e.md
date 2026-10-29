# Phase 5 — Playwright E2E Implementation Plan

Status (2026-10-29): Slice A (harness), Slice B (core journeys), and the bulk of
Slice C are implemented. `npm run test:e2e` passes 46 tests in Chromium plus the
mobile project (1 worker); the opt-in db-down scenario also passes separately.
Callback URLs and the `data-pending` cover were added, closing the corresponding
Phase 2/Phase 5 gaps. Acceptance criteria below are partially met; remaining
gaps are full permutation coverage and automated recovery.

Source of truth for implementation of Phase 5 (browser E2E). Continue slice by slice from this file. Update checkboxes in `testing_plan.md` as slices land. Do not implement items marked deferred to Phase 6.

## 0. Decisions

| # | Topic | Decision |
|---|---|---|
| 1 | Isolation | Branch-exclusive E2E, `workers: 1`, branch-level truncate in global setup/teardown; E2E and HTTP never share a branch concurrently |
| 2 | Mobile | `@mobile` subset only; full journeys desktop-only |
| 3 | DB outage | Two-server approach, and automate recovery (boundary + digest + one `[request error]` line + successful "Try again") |
| 4 | Deep links | Add callback URLs as a product change |
| 5 | Delivery | Three slices: harness → core journeys → hardening |
| 6 | Google OAuth | Provider-redirect abort only; full consent flow stays manual |
| 7 | `data-pending` | Cover in Playwright via delayed RSC navigation |
| 8 | Permutations | Trim permutations already covered by Phases 1–4 (≈80 tests, not ≈112) |
| 9 | Two-tab races | Runtime budget change: mark `@slow`/`@nightly`; do not weaken invariants already proven in DB tests |
| 10 | E2E ↔ HTTP port split | E2E app on 3200, HTTP on 3100, db-down helper server on 3201 |

Runtime budgets:
- PR smoke (`@smoke`) < 3 minutes.
- Nightly desktop (`--project=chromium`) < 15 minutes (was 10; raised to accommodate `@slow` two-tab races).
- `@slow` two-tab races run only on nightly, never on PR smoke.

## 1. Test gaps absorbed into Phase 5

### 5.1 Auth
- Signed-out matrix for every protected route (`/account`, `/events/new`, `/events/:id/edit`, `/wishlist`, `/my-events`, `/notifications`).
- Navbar signed-in/out link set + unread bell label.
- Sign-up validation (weak/duplicate) inline.
- Expired-session RSVP lands on sign-in with no "Something went wrong".
- Signed-out → sign-in → original destination restored (callback URLs, new).
- Session expiry covers no-session banner.

### 5.2 Browse and discovery
- Only public upcoming events appear; private/past absent.
- Category chips filter + global/unfiltered counts that do not change when a category is active.
- When/sort/search change results.
- `%` and `_` match literally.
- Pagination range + `?page=999` clamp.
- No-results state differs from no-events state.
- Organizer filter chip `By <name>` + removal.
- Combined filter + page 2 keeps filters; changing a filter resets page to 1 (UI-level).
- Capped/full event card shows "Full".
- Unknown event id → generic not-found page.
- `data-pending` asserted via delayed RSC response (`page.route` delay).

### 5.3 Create and edit
- Validation errors inline.
- Valid create redirects to detail.
- Public/private render correctly.
- Capacity/category persist.
- Browser-zone wall clock displays correctly (timezoned run with `timezoneId: 'America/New_York'` and default zone variant).
- No-JS create falls back to `APP_TIME_ZONE` (optional, can be dropped).
- Title-only edit preserves displayed time; preserves legacy null `timeZone` (assert DB).
- Editing date changes instant, not wall clock only.
- Capacity below GOING count rejected with retained values.
- Capacity raise promotes waitlisted users.
- Deleting event redirects + notifies holders (no dead link on cancellation).
- Signed-out create/edit redirect to sign-in.
- Past date shows server inline error.
- `eventCreate` rate limit via seeded counter (do not create 10 events).
- Non-organizer edit redirects to `/events`.
- Delete confirm/cancel paths.

### 5.4 RSVP and waitlist
- GOING/MAYBE/NOT_GOING selectable.
- Switching status updates counts.
- Remove RSVP asks confirmation.
- Full event shows wishlist CTA.
- Joining wishlist shows queue position.
- Second user cancelling promotes first.
- Promoted user sees "You got in!" banner; dismiss persists after reload (both detail and `/wishlist`).
- Notify toggle persists after reload.
- Past events read-only; ended events reject RSVP (UI read-only + DB authority).
- Notify opt-out suppresses later `EVENT_UPDATED`.
- RSVPed attendee name appears in roster.
- Two-context last-seat RSVP race (`@slow`, nightly).

### 5.5 Wishlist
- Positions render correctly.
- Leave wishlist works + confirm/decline.
- Promoted section renders/dismisses and stays dismissed after reload.
- Ended wishlist entries show "Event ended" instead of leave.
- Empty state.
- Position updates when someone ahead leaves.

### 5.6 Private events and invites
- Outsider gets 404 (API) / not-found (page).
- Organizer creates invite; creating twice same link.
- Invite preview hides description for private events (absent from raw HTML, not just hidden).
- Signed-out invite prompts sign-in, and callback URL preserves token.
- Accepting creates GOING / WAITLISTED when full.
- Regenerate invalidates old link.
- Revoke invalidates link.
- Host redirected away from invite page.
- Two-tab create same token (`@slow`, nightly).
- Accept while already GOING is idempotent.
- Past event invite shows "This event has ended".
- Invite panel organizer-only; outsider sees no panels.
- Old link after regenerate/revoke shows "Invite not found".

### 5.7 Comments
- Add comment appears with author name without manual reload.
- Comment count updates.
- 51 seeded → "Comments (51)" with 50 rendered.
- Delete own comment.
- Organizer can delete any.
- Others cannot delete another's.
- Past events read-only.
- 6th rapid comment shows rate-limit message (per-user independence verified).
- Signed-out sees comments + sign-in prompt.
- Organizer badge.
- Stored XSS via DB-seeded `authorName` does not execute.

### 5.8 Organizer dashboard
- Stats: upcoming/going/wishlisted/past/average fill.
- Upcoming/past/all views work (tab counts).
- Search filters dashboard.
- Sort by date/fill/newest.
- Empty states per view.
- Non-organizer cannot see another's events; second signed-in user sees own empty dashboard.
- CSV link points to export; download starts; outsider never sees link.
- Check-in/undo journey: progress bar, checked count, idempotence.
- Uncapped event shows `Avg fill —`.
- Description-only edit does not notify holders.

### 5.9 Notifications
- Promotion/update/cancellation/comment/reminder all appear.
- "Coming up" widget: next RSVPs, Starts… labels, hidden when empty.
- Reminder generation requires opening `/notifications`, then reload + second reload dedupe (24 h).
- Unread bell count matches page; all five type labels render.
- Mark one updates count; mark all clears.
- 57 notifications paginate 20/page; `?page=999` clamp; marking on page 2 keeps page.
- Cancellation notification no dead event link.
- Mark-all-read disabled at zero.
- Scoping: attacker's mark-all-read does not touch victim's rows.

### 5.10 Calendar links
- ICS download parses: CRLF, `BEGIN:VEVENT`, UID, DTSTART, DTEND exactly +2 h, SUMMARY.
- Google Calendar link contains expected encoded parameters.

### 5.11 Security and authorization
- Outsider cannot edit/delete or check in attendees/export.
- Outsider cannot read private event (page + raw HTML).
- Users cannot read another user's notifications.
- Stored XSS (title/description/comment/author name) does not execute (window flag + dialog listener).
- CSV injection neutralized in downloaded file.
- Two-context check-in/undo races (`@slow`, nightly).
- Two-context RSVP race (added above).
- Non-organizer sees no roster/CSV/wishlist/invite panels.

### 5.12 Resilience and accessibility
- DB outage renders error boundary, no raw 500, digest shown, one correlatable `[request error]` log line (broken-DB server on 3201); recovery via "Try again" succeeds (also automated).
- Axe scan (serious/critical) on home, browse, detail (public + private-as-holder), create, dashboard, wishlist, notifications, sign-in/sign-up.
- Keyboard navigable filters/RSVP/forms; mobile drawer keyboard (Escape, focus return, `aria-expanded`).
- Async errors announced (`role="alert"`).
- Mobile: no horizontal overflow on all main pages; nav/filters/cards usable.

### 5.13 External
- Google sign-in click starts provider redirect; abort before consent.
- Document full Google consent flow remains manual.

## 2. Gaps moved elsewhere

- Phase 6 (not E2E): 3.8 manual cleanup/backfill scripts (5 items); 3.9 when-filter app-zone boundaries (DB level); 4.2 CSV stream failure on server error (fault injection).
- Invite/check-in atomicity: invite concurrency stays DB-only; check-in covered in E2E scoped `@slow`.
- 2.4 `data-pending`: covered in E2E via delayed RSC, simultaneously closes the Phase 2 unchecked item.

## 3. Slice A — Harness (implement first)

Files:
- `playwright.config.ts`: dedicated E2E port (`TEST_E2E_BASE_URL`, default `http://localhost:3200`), `workers: 1`, `fullyParallel: false`, setup project, tags, env guard, `webServer` = `tsx scripts/start-test-app.ts`.
- `tests/e2e/auth.setup.ts`: create organizer/attendee/outsider via real UI (sequential, 429 retry), save `tests/.auth/{role}.json` + `tests/.auth/roster.json`.
- `tests/e2e/support/env.ts`: extend with `E2E_BASE_URL`, `E2E_DB_DOWN_URL`, storage-state + roster helpers.
- `tests/e2e/support/db.ts`: load `.env.test` before Prisma; `assertTestDatabaseSafety()`; reuse `tests/support/factories.ts` + `resetDomainTables`; seed helpers (`seedEvent`, `seedRsvp`, `seedNotifications`, `seedComments`, `clearRateLimits`, `seedRateLimit`).
- `tests/e2e/support/fixtures.ts`: role-authenticated pages/contexts; `seededEvent` fixture; run-id prefix.
- `tests/e2e/support/axe.ts`: AxeBuilder wrapper (serious/critical).
- `tests/e2e/global-setup.ts`: truncate once; optional db-down server (port 3201) when `E2E_DB_DOWN=1`; hosts only.
- `tests/e2e/global-teardown.ts`: stop db-down server, truncate, assert all domain tables zero, disconnect.
- `scripts/start-test-app.ts`: build once (unless `E2E_SKIP_BUILD=1`) + start with stdout/stderr tee to `test-results/server.log`; Windows tree kill.
- npm scripts: `test:e2e:smoke`, `test:e2e:mobile`, `test:e2e:dbdown` (runs with `E2E_DB_DOWN=1`).

Safety/documentation:
- `TESTING.md`: ports, tags, storage states, seeding/truncation, cross-layer branch exclusivity.

## 4. Slice B — Core journeys

Specs in order (full detail in §1):
1. `auth.spec.ts` (incl. callback URLs + expiry)
2. `browse.spec.ts` (incl. `data-pending`)
3. `events.spec.ts`
4. `rsvp.spec.ts`
5. `wishlist.spec.ts`
6. `invites.spec.ts`
7. `comments.spec.ts`

Tags: `@smoke` on ~10–12 critical; `@slow`/`@nightly` on two-context races; `@mobile` only where responsive is the point.

## 5. Slice C — Hardening + resilience + a11y

Specs:
8. `dashboard.spec.ts`
9. `notifications.spec.ts`
10. `calendar.spec.ts`
11. `security.spec.ts`
12. `a11y.spec.ts` (Chromium only)
13. `responsive.spec.ts` (`@mobile`)
14. `resilience.spec.ts` (`@dbdown`, `E2E_DB_DOWN=1`) — boundary + digest + one log line + recovery via "Try again"
15. `external.spec.ts`

Doc updates at slice end:
- `testing_plan.md`: check 0.2/0.5/0.6/2.4/5.x; move the three items above to Phase 6; update Definition of Done ("only smoke exists" done once specs land); note callback-URL product change.
- `TESTING.md`: final roster/storage/port/tag/db-down notes.

## 6. Production changes

1. Callback URLs (`src/proxy.ts`, sign-in/sign-up pages, invite links):
   - Wrap auth middleware redirect so a redirect to login includes `?next=<encoded same-origin path+search>`.
   - `SignInPage`/`SignUpPage` read `next` from `useSearchParams`, validate (starts with `/`, no `//`), `router.push(next ?? '/')`.
   - Invite sign-in/sign-up links include `?next=/invite/<token>`.
   - Validate against open redirect (only same-origin relative paths).
2. `scripts/start-test-app.ts` (start wrapper + tee logs).

No other production code changes are expected; axe failures must be fixed as tests are added and tracked as the finding test.

## 7. Resilience detail

Broken-DB server on 3201 with invalid `DATABASE_URL`, same `.next` build, reuses localhost storage states:
1. Navigate to a page on 3201 → assert error boundary renders, digest visible, exactly one `[request error]` line in `test-results/server-dbdown.log`.
2. Kill broken server, spawn working server on 3201.
3. Click "Try again" → page recovers and renders.
Document a fallback: if recovery proves flaky across two green runs, keep boundary/digest/log in E2E and push recovery to manual + component tests, reversing decision 3's automation half.

## 8. Acceptance criteria

- `npm run db:test:up -- --force && npm run test:e2e` green twice on empty branch (desktop + mobile subset, no leftovers, domain tables 0 before/after).
- `npm run test:e2e:smoke` < 3 min; traces/screenshots/video on failure; no secrets in artifacts.
- Empty-branch recovery check passes.
- `testing_plan.md` checkboxes updated to match.

### File list summary (new/changed)

```
playwright.config.ts
scripts/start-test-app.ts
tests/e2e/auth.setup.ts
tests/e2e/global-setup.ts
tests/e2e/global-teardown.ts
tests/e2e/support/env.ts
tests/e2e/support/db.ts
tests/e2e/support/fixtures.ts
tests/e2e/support/axe.ts
tests/e2e/auth.spec.ts
tests/e2e/browse.spec.ts
tests/e2e/events.spec.ts
tests/e2e/rsvp.spec.ts
tests/e2e/wishlist.spec.ts
tests/e2e/invites.spec.ts
tests/e2e/comments.spec.ts
tests/e2e/dashboard.spec.ts
tests/e2e/notifications.spec.ts
tests/e2e/calendar.spec.ts
tests/e2e/security.spec.ts
tests/e2e/a11y.spec.ts
tests/e2e/responsive.spec.ts
tests/e2e/resilience.spec.ts
tests/e2e/external.spec.ts
src/proxy.ts              (+callback URLs)
src/app/auth/sign-in/page.tsx (+callback URL read)
src/app/auth/sign-up/page.tsx (+callback URL read)
src/app/invite/[token]/page.tsx (+callback URL in links)
```

`.auth/` and `roster.json` artifacts must stay gitignored (already covered by `tests/.auth`).