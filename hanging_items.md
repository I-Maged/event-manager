# Hanging Items — Implementation Plan

| | |
|---|---|
| Repository | `D:\career-new\event-manager` |
| Source | Review of `implementation_plan.md` at revision `cb9d1a9` ("timezone & rate limiting") |
| Baseline | Plan's reviewed revision was `c44ec52`; Phase 1–5 were implemented in `afc5e05`, `594a4de`, `40c5d19`, `cb9d1a9` |
| Scope | The 9 hanging items from that review, **plus** every Phase 0–5 verification step that is still unproven and every Appendix B item that remains unfixed |
| Status | **Implemented** — see "Implementation record" at the bottom. Two items still need an external action (scheduled GC job, deploy env). |

> **Plan-mode note:** this file is the deliverable. All edits below must be made by switching into an implementation agent. Steps are written to be executed top-to-bottom.
>
> **Path note:** written to `C:\Users\Maged\.opencode\plan\hanging_items.md` because plan documents may only be written there in Plan mode. Move/copy it next to `implementation_plan.md` in the repo root if you want it versioned with the code.

## How to read this plan

- Items keep the numbering from the review: **H1–H9** are the 9 hanging items; **B1–B7** are the previously "out of scope" Appendix B findings; **V1–V4** are the missing verification artifacts.
- Every item has **Evidence**, **Recommended decision**, **Steps**, **Verification**, **Rollback**.
- "Small" items are one commit; grouped items share a PR.

## Decisions at a glance

| # | Item | Recommended decision |
|---|---|---|
| H1 | `APP_TIME_ZONE` unset (defaults to UTC) | **Set it per deploy target, then backfill legacy rows** (H1.1 + H1.3) |
| H2 | No post-fix concurrency evidence | **Run the probe and commit a `post-fix.log`**, gate it in `npm run verify` |
| H3 | Migration/probe branch target unproven | **Add a guard to write-probes + a `preflight` script** that prints the target host/branch |
| H4 | Rate-limit sweeper is a per-process counter | **Keep the lazy sweep as best-effort, add a Neon scheduled delete** as the real GC |
| H5 | Limiter fails open | **Keep fail-open for RSVP/comment; log + count it**, revisit only on observed abuse |
| H6 | Uneven rate-limit coverage | **Add `createEvent`; leave cheap toggles unlimited; add `deleteComment` + `checkIn*` at generous limits** |
| H7 | Editing a legacy (`timeZone = null`) event stamps a zone | **Only persist `timeZone` when the wall clock actually changes** |
| H8 | Appendix B findings still open | **Fix B1–B4 and B7 now; B5 as a guard, B6 as report-only headers** |
| H9 | Build + manual QA unproven | **`npm run verify` + a checked-in manual QA checklist** |
| B1 | `getUserWishlist` N+1 | Fix with a **2-query** position computation |
| B2 | Detail page duplicate `getEventById`/`getRsvpCounts` | Wrap both in **React `cache()`** |
| B3 | `InviteLinkManager` hydration mismatch | Render the **relative URL**, build the absolute one at click time |
| B4 | Unread-count mismatch | Notifications page uses **`getUnreadCount()`** |
| B5 | Accessors lack their own authz | Add a **`viewerId` parameter + explicit check** to the three accessors |
| B6 | No security headers | Add **`headers()`** in `next.config.ts`, CSP report-only first |
| B7 | `src/generated` breaks repo-wide lint | Add it to **`globalIgnores`** |
| — | PR granularity | Retrospective only: 4 commits exist; keep them, no rewrite |

---

## Phase H1 — Environment truth (do first)

**Goal:** the running app and the probes target the intended zone and the intended database branch.

### H1.1 — Set `APP_TIME_ZONE`

**Evidence.** `.env` does not define `APP_TIME_ZONE`, so `DEFAULT_TIME_ZONE` (`src/lib/time.ts:25-27`) resolves to `'UTC'`. That value is used for:
- legacy rows with `timeZone = null` (`resolveTimeZone`),
- no-JS form submits (`event-validation.ts:62`),
- browse day boundaries "Today / Next 7 days / Next 30 days" (`events.ts:84-88` via `addDaysInZone`).

README documents the variable but the deploy value was never chosen.

**Recommended decision.** Pick the zone that matches the primary audience (e.g. `Europe/Berlin` for a Central-European user base) and set it in the deploy environment **and** in local `.env`; keep `'UTC'` only if the audience is genuinely global and legacy rows are backfilled.

**Steps.**
1. Decide the value with the product owner (one answer, not per-developer).
2. Add it to `.env` next to the other app variables, and to the deploy env / `.env.example` if one is added.
3. Note that this changes browse day boundaries for everyone; treat it as a release note, not a silent change.

**Verification.** `npx tsx scripts/timezone-check.ts` still passes; create an event with JS disabled (or empty `timeZone`) and confirm it renders in the chosen zone; confirm the "Today" filter boundary matches that zone.

**Rollback.** Revert the env value (code untouched).

### H1.2 — Backfill legacy `timeZone` rows (optional but recommended with H1.1)

**Evidence.** `Event.timeZone` is nullable and there is no backfill; every pre-fix row renders in `APP_TIME_ZONE`. Any event authored elsewhere will display at the wrong wall clock after this change too.

**Recommended decision.** Backfill only if you can identify the authoring zone; otherwise leave rows `null` and rely on `APP_TIME_ZONE`. Do **not** guess per-row.

**Steps.**
1. If the audience is single-zone, add a one-off SQL/`tsx` script `scripts/backfill-time-zone.ts`: `UPDATE "Event" SET "timeZone" = $1 WHERE "timeZone" IS NULL` (parameterised, prints the affected count, dry-run by default).
2. If the audience is multi-zone, skip the backfill and instead surface the zone in the UI (see H7.3) so organizers can correct old events.

**Verification.** `SELECT count(*) FROM "Event" WHERE "timeZone" IS NULL` before/after; spot-check a sample of events in the UI.

**Rollback.** `UPDATE "Event" SET "timeZone" = NULL WHERE ...` for the affected ids (store them in the script's output).

### H1.3 — Guard write-probes against the wrong branch

**Evidence.** `scripts/rsvp-concurrency.ts` and `scripts/rate-limit-check.ts` both insert and delete rows. `scripts/rsvp-concurrency.ts:3` says "DEV BRANCH ONLY" but nothing enforces it; `.env` points at a single Neon host and there is no record of which branch the migrations/probes ran against (DoD #4 unproven).

**Recommended decision.** Make the destructive probes refuse to run unless an explicit env flag is set, and print the resolved database host so a human can confirm it. Cheap and prevents an accident on the primary branch.

**Steps.**
1. Add `scripts/preflight.ts` that prints the host portion of `DATABASE_URL` / `DATABASE_URL_UNPOOLED` (never the credentials) and, when `PROBE_ALLOW !== '1'`, exits 1 with "set PROBE_ALLOW=1 and confirm the branch".
2. Call the same check at the top of `rsvp-concurrency.ts` and `rate-limit-check.ts`.
3. Document the flag in README and in each script's header.
4. Record (in the PR description) which Neon branch the two `20261019*` migrations were applied to.

**Verification.** Run each probe with `PROBE_ALLOW` unset → exits without touching the DB; set it → proceeds.

**Rollback.** Delete `preflight.ts` and the guard import.

---

## Phase H2 — Close the verification gaps

**Goal:** every Phase 0–5 step that asserted "this passes" has a reproducible, checked-in result.

### H2.1 — Post-fix concurrency evidence

**Evidence.** `scripts/rsvp-concurrency.pre-fix.log` exists (12 `OVERBOOKED` failures) but there is no post-fix log, so DoD #1 ("script passes") is unproven.

**Recommended decision.** Run it on the dev branch and commit `scripts/rsvp-concurrency.post-fix.log`. Do the same for the rate-limit probe.

**Steps.**
1. `PROBE_ALLOW=1 npx tsx scripts/rsvp-concurrency.ts` on the dev branch; tee output to `scripts/rsvp-concurrency.post-fix.log`.
2. `PROBE_ALLOW=1 npx tsx scripts/rate-limit-check.ts`; tee to `scripts/rate-limit-check.log`.
3. Keep the fixture cleanup as-is (the scripts already delete by `eventId` / `probe:` key prefix).

**Verification.** Both logs end in "all invariants held."; `git status` shows no leftover `probe-*` rows (spot-check with a count query).

**Rollback.** Logs are additive; delete them.

### H2.2 — `npm run verify`

**Evidence.** `package.json` has only `dev/build/start/lint`. Phase 1.8, 3.5, 5.5 and DoD #2 require a specific set of commands that are currently copy-pasted by hand.

**Recommended decision.** Add one script that runs the full gate.

**Steps.** Add to `package.json`:

```json
"verify": "tsc --noEmit && eslint src/app src/components src/lib src/db.ts src/proxy.ts && tsx scripts/timezone-check.ts && tsx scripts/rate-limit-check.ts && tsx scripts/rsvp-concurrency.ts && next build"
```

Keep the DB probes out of plain CI unless the CI has a dev branch; if it does not, split into `verify` (no DB) and `verify:db`.

**Verification.** `npm run verify` exits 0 on a clean checkout with the dev branch configured.

**Rollback.** Remove the script entries.

### H2.3 — Manual QA checklist (items 2.5, 3.5, 5.5, DoD #3)

**Evidence.** Four manual checks have no artifact: session-expiry redirect with no error banner; DB-outage error boundary + "Try again"; a past-date RSVP rejected; rapid clicking yields the rate-limit message.

**Recommended decision.** Check in a short `docs/manual-qa.md` checklist and require it in the PR template; manual checks are not automatable cheaply here.

**Steps.**
1. Add `docs/manual-qa.md` with the five DoD #3 scenarios and the exact repro (delete session cookie, point `DATABASE_URL` at a bad host in a scratch branch, etc.).
2. Run it once for the release that contains Phases 1–5 and paste the results into the PR.

**Verification.** Checklist is complete and signed off in the PR.

**Rollback.** Documentation only.

---

## Phase H3 — Rate-limit hardening

### H3.1 — Real GC for the counter table

**Evidence.** `src/lib/rate-limit.ts:69-90` sweeps every 500th call using a **module-level** counter. On serverless (multiple instances and cold starts) that counter resets constantly, so the sweep may effectively never fire and `RateLimit` rows accumulate.

**Recommended decision.** Keep the in-process sweep (it is harmless), but add the authoritative cleanup as a scheduled database job. This stack has no cron; the Neon scheduled-job path is the right home (see the `neon` skill).

**Steps.**
1. Add `prisma/migrations/..._rate_limit_cleanup/` or a documented snippet with the job body:
   `DELETE FROM "RateLimit" WHERE "windowStart" < now() - interval '1 day';`
2. Schedule it (Neon scheduled function/cron) at e.g. hourly.
3. Document in `src/lib/rate-limit.ts` that the lazy sweep is best-effort only and the job is the source of truth.
4. Optional: raise `CLEANUP_EVERY` now that the job exists.

**Verification.** Insert a stale row (`windowStart` 48 h old), run the job, confirm it is gone; confirm the lazy path still cannot throw (`try/catch` at `rate-limit.ts:85-89`).

**Rollback.** Drop the scheduled job; the table is unaffected.

### H3.2 — Fail-open policy

**Evidence.** `enforceRateLimit` swallows any error and returns `null` ("failing open", `rate-limit.ts:101-113`). An outage of the limiter silently removes the guard; the plan never stated the intended policy.

**Recommended decision.** Keep fail-open for RSVP and comment (availability matters more than perfect throttling, and the DB is down in the same scenario anyway), but make the choice observable: log at a level that can be alerted on and add a counter/log key.

**Steps.**
1. Keep returning `null` on error, but include a stable marker (`'rate limit check failed (failing open)'` already exists) and add the `scope` + `userId` hash (not the raw id) so the failure can be alerted/analysed without logging identities.
2. Note the policy in the `enforceRateLimit` JSDoc (it is partly there) and in the manual QA doc.
3. Revisit fail-closed only if abuse is actually observed on the `comment` scope.

**Verification.** Point the limiter at a missing table in a scratch branch: `addComment`/`setRsvp` still succeed and one structured log line is emitted.

**Rollback.** Code-only.

### H3.3 — Coverage gaps

**Evidence.** Plan's Phase 5.3 covered 7 actions; the implementation added `revokeInviteLink` and `updateEvent`, but left these unthrottled: `createEvent`, `deleteEvent`, `deleteComment`, `markRead`/`markAllRead`, `dismissPromotion`, `setNotifyOnUpdate`, `checkInAttendee`/`undoCheckIn`.

**Recommended decision.** Add limits only where amplification exists: `createEvent` (fan-out = new events, unbounded storage) and `deleteComment` (destructive); check-in is organizer-only and cheap, so cap it generously. Leave the per-user toggles (`markRead*`, `dismissPromotion`, `setNotifyOnUpdate`) unlimited — they are cheap, idempotent, and already scoped to the caller.

**Steps.**
1. Add scopes to `RATE_LIMITS` in `src/lib/rate-limit.ts`:
   - `eventCreate: { limit: 10, windowMs: 60 * 60_000 }` (10/hour),
   - `commentDelete: { limit: 30, windowMs: 60_000 }`,
   - `checkIn: { limit: 60, windowMs: 60_000 }`.
2. Apply after the auth guard in `src/app/events/new/actions.ts` (`createEvent`), `src/app/events/[id]/comments/actions.ts` (`deleteComment`), and `src/app/events/actions.ts` (`checkInAttendee`, `undoCheckIn`).
3. Return the existing `{ ok:false, error }` / `{ error }` shape so no client changes are needed.
4. Add the new scopes to `scripts/rate-limit-check.ts` shape guards.

**Verification.** Call each action past its limit and confirm the message surfaces (see `RATE_LIMIT_MESSAGE`); `npx tsx scripts/rate-limit-check.ts` passes.

**Rollback.** Remove the calls and scopes.

---

## Phase H4 — Timezone edge cases

### H4.1 — Editing a legacy event must not silently stamp a zone

**Evidence.** `src/app/events/[id]/edit/page.tsx:35-36` seeds the form with `resolveTimeZone(event.timeZone)`, so a legacy row (`null`) becomes `DEFAULT_TIME_ZONE` and is written back on any save (`edit/actions.ts:74-77` spreads `parsed.data.timeZone`). If the original was authored in a different zone, a no-op edit shifts its displayed wall clock.

**Recommended decision.** Persist `timeZone` only when the organizer actually changes the wall clock; if the date is unchanged and the stored zone was `null`, keep it `null`. Do not add a migration for this.

**Steps.**
1. In `src/app/events/[id]/edit/page.tsx`, pass the original `dateValue` and original `timeZone` (including `null`) alongside the display fallback.
2. In `EditEventForm.tsx`, submit both the display `timeZone` (as today) and a hidden `originalDate` / `originalTimeZone`.
3. In `edit/actions.ts`, after `parseEventForm`, if `parsed.data.date.getTime()` equals the original instant, write `timeZone: originalTimeZone` (which may be `null`) instead of `parsed.data.timeZone`.
4. Keep the create path unchanged (a new event always captures the author's zone).

**Verification.** `scripts/timezone-check.ts` passes; create a legacy row manually (`timeZone = null`), open + save without touching the date, confirm `timeZone` stays `null` and the render is unchanged; change the time and confirm the zone is captured.

**Rollback.** Code-only.

### H4.2 — `formatEventDate` compatibility re-export (low priority)

**Evidence.** The plan (4.2) asked to re-export `formatEventDate` from `@/lib/events` "so the ~10 existing imports keep working with zero churn". The implementation instead moved every import to `@/lib/time`; nothing in-repo imports it from `lib/events` any more.

**Recommended decision.** No functional need; add a one-line re-export only if you want to preserve the old module surface for any downstream/private fork.

**Steps.** Optionally add `export { formatEventDate } from '@/lib/time';` to `src/lib/events.ts`.

**Verification.** `tsc --noEmit` clean.

**Rollback.** Remove the line.

### H4.3 — Surface the zone in the UI (optional)

**Evidence.** Nothing tells the organizer which zone their event will display in; a misplaced event cannot be corrected except by editing the wall clock.

**Recommended decision.** Defer unless H1.2 chose "multi-zone, no backfill". If it did, show the resolved zone next to the date input on create/edit.

**Steps.** Render `resolveTimeZone(event.timeZone)` as muted text beside the date field; no new input needed.

**Verification.** Create/edit an event and confirm the label matches the rendered date.

**Rollback.** UI-only.

---

## Phase H5 — Appendix B findings (now in scope)

### B1 — `getUserWishlist` N+1

**Evidence.** `src/lib/events.ts:401-417` calls `getWaitlistPosition` per row → 1 + N queries.

**Recommended decision.** Replace with two queries: fetch the user's waitlisted rows (with `event`), then fetch all waitlisted rows for those events once and compute positions in memory.

**Steps.**
1. Query A: the existing `findMany` (keep `include: { event: true }`).
2. Query B: `prisma.rSVP.findMany({ where: { eventId: { in: ids }, status: 'WAITLISTED' }, select: { eventId, userId, createdAt }, orderBy: { createdAt: 'asc' } })`.
3. Build a `Map<eventId, Array<{userId, createdAt}>>` and derive each row's 1-based index; return the same `WishlistEntry[]` shape so the page is untouched.
4. Keep `getWaitlistPosition` for the single-event callers (event detail page).

**Verification.** `npx tsc --noEmit`; open `/wishlist` with several entries and confirm positions match the organizer view; add a temporary query log to confirm 2 queries.

**Rollback.** Revert the function.

### B2 — Detail page duplicate reads

**Evidence.** `/events/[id]` calls `getEventById` in `generateMetadata`, `RsvpSection`, `CommentSection` and the page (4×, `page.tsx:38,52,96,298`) and `getRsvpCounts` twice (`:55,305`).

**Recommended decision.** Wrap both in React `cache()` so they dedupe within a request/render pass.

**Steps.**
1. In `src/lib/events.ts`: `import { cache } from 'react';` and export `export const getEventById = cache(async (id: string) => ...)`.
2. Do the same for `getRsvpCounts`.
3. Check the Next docs in `node_modules/next/dist/docs/` for this version before applying, since Cache Components is enabled — `cache()` remains request-scoped memoization, but confirm `connection()`/`instant` interplay is unchanged.

**Verification.** `npx tsc --noEmit`; detail page behaviour unchanged; query count drops (temporary log).

**Rollback.** Revert to plain functions.

### B3 — `InviteLinkManager` hydration mismatch

**Evidence.** `src/app/events/[id]/InviteLinkManager.tsx:22-26` branches on `typeof window !== 'undefined'` during render, so the SSR string (`/invite/<token>`) differs from the first client render (absolute URL).

**Recommended decision.** Render the relative path server-and-client; build the absolute URL only inside the copy handler.

**Steps.**
1. Display `` `/invite/${token}` `` always.
2. In `handleCopy`, compute `new URL(`/invite/${token}`, window.location.origin).toString()` and copy that.
3. Keep the existing `try/catch` around `navigator.clipboard`.

**Verification.** No hydration warning in the console on a private event's detail page; the copied text is an absolute URL.

**Rollback.** Revert the component.

### B4 — Unread-count mismatch

**Evidence.** `notifications/page.tsx:32` counts unread within the fetched ≤30 rows; `getUnreadCount` (`src/lib/notifications.ts:16-21`) counts all unread. The navbar and the page header disagree once there are >30 notifications.

**Recommended decision.** Use `getUnreadCount(userId)` for the page header and the `MarkAllReadButton` `disabled` prop.

**Steps.** Call `getUnreadCount` in `notifications/page.tsx` (it already has `userId`) and use it in both places.

**Verification.** Seed >30 notifications, mark one read, confirm page header and navbar bell agree.

**Rollback.** Revert the page.

### B5 — Accessors lack their own authorization

**Evidence.** `getAttendees` (`events.ts:360`), `getWishlist` (`:308`) and `getComments` (`:327`) return data with no viewer check; they are only safe because every current caller gates with `canViewEvent` first. A future caller can leak private-event data by omission.

**Recommended decision.** Make the check explicit at the accessor boundary: require a `viewerId` and assert visibility inside. Keep the current call sites passing the already-resolved viewer.

**Steps.**
1. Add a private helper `assertCanView(event, viewerId)` that throws (server-only) or returns a discriminated error; prefer a throwing helper so a misuse fails loudly in development.
2. Change signatures to `getAttendees(event, viewerId)`, `getWishlist(event, viewerId)`, `getComments(event, viewerId, limit?)` — taking the `Event` the caller already fetched avoids an extra read.
3. Update the three call sites in `src/app/events/[id]/page.tsx` to pass `event` + `viewerId`.
4. For the API route `src/app/api/events/[id]/attendees/route.ts`, confirm it already authorizes the organizer and, if so, pass that viewer.

**Verification.** `tsc --noEmit`; detail page renders for organizer/attendee/stranger; a unit-style `tsx` check that `assertCanView` throws for a stranger on a private event.

**Rollback.** Revert signatures and call sites.

### B6 — Security headers

**Evidence.** `next.config.ts` sets only build flags; there are no security headers.

**Recommended decision.** Add `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options`, `Permissions-Policy` unconditionally, and a **Content-Security-Policy in report-only** mode first (Next injects inline scripts; a blocking CSP needs a nonce via `src/proxy.ts`).

**Steps.**
1. Read the Next docs for this version (`node_modules/next/dist/docs/`) on `async headers()` before editing.
2. Add to `next.config.ts`:

```ts
async headers() {
  return [
    {
      source: '/:path*',
      headers: [
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        { key: 'Content-Security-Policy-Report-Only', value: "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' https://*.neon.tech; frame-ancestors 'none'" },
      ],
    },
  ];
}
```
3. Watch the report-only violations against the Neon Auth redirect and the Google sign-in flow, then consider promoting to a blocking CSP with a nonce in `src/proxy.ts`.

**Verification.** `next build` passes; `curl -I` shows the headers; the browser console shows no CSP violations from normal flows.

**Rollback.** Remove the `headers()` block.

### B7 — `src/generated` breaks repo-wide lint

**Evidence.** `eslint.config.mjs:9-15` `globalIgnores` omits `src/generated`, so `npm run lint` reports ~226 errors, all generated code (source plan baseline).

**Recommended decision.** Add `"src/generated/**"` to `globalIgnores`.

**Steps.** Append the entry to the array in `eslint.config.mjs`.

**Verification.** `npm run lint` exits clean (or only shows pre-existing non-generated findings).

**Rollback.** Remove the entry.

---

## Phase H6 — Process (retrospective, no code)

**H6.1 — PR granularity.** The plan recommended 4 PRs; the work landed as 4 commits on one branch (`afc5e05`, `594a4de`, `40c5d19`, `cb9d1a9`). **Decision:** keep them; do not rewrite history. Enforce the split going forward via the PR template.

**H6.2 — Commit the plan docs?** `implementation_plan.md` and `critical-high-fix-plan.md` are currently committed at the repo root. **Decision:** move them under `docs/` (or delete) so the root stays deployment-clean; keep this file alongside them.

**Verification.** `git log` shows the intended split; `docs/` contains the plan history.

**Rollback.** Move the files back.

---

## Execution order & estimates

1. **H1** (env + branch guard) — ~1 h.
2. **H2** (verification closure: run probes, logs, `verify`, QA doc) — ~1.5 h (+ probe runtime).
3. **H3** (rate-limit hardening) — ~1.5 h + scheduled-job setup.
4. **H4** (legacy edit zone) — ~1 h.
5. **B1–B7** — ~4–6 h total (B1 ~1 h, B2 ~0.5 h, B3 ~0.5 h, B4 ~0.25 h, B5 ~1.5 h, B6 ~1 h, B7 ~5 min).
6. **H6** — documentation only.

Suggested PRs: **PR-A** H1 + H2; **PR-B** H3 + H4; **PR-C** B1–B4 + B7; **PR-D** B5 + B6. Each PR must end with `npm run verify` green.

## Definition of done

1. `APP_TIME_ZONE` is set and documented; legacy-row decision recorded (backfilled or intentionally left null).
2. `scripts/rsvp-concurrency.post-fix.log` and `scripts/rate-limit-check.log` are committed and show "all invariants held."
3. `npm run verify` exits 0 (or the documented no-DB variant in CI).
4. `PROBE_ALLOW` guard prevents an accidental primary-branch probe.
5. `docs/manual-qa.md` is checked in and signed off for the release.
6. `RateLimit` has a scheduled GC; the fail-open policy is documented and observable.
7. New rate-limit scopes are in place and asserted by `rate-limit-check.ts`.
8. Editing a legacy event without changing the clock leaves `timeZone` untouched.
9. B1–B7 fixed; `npm run lint` is clean.

## Open decisions to confirm before coding

1. **H1.1** — which IANA zone is the deploy default (or stay UTC and accept UTC for legacy/no-JS)?
2. **H1.2** — backfill legacy `timeZone` or leave null?
3. **H3.1** — use a Neon scheduled job for cleanup, or an external scheduler?
4. **H3.3** — accept `createEvent` at 10/hour, or a different budget?
5. **B5** — throw (fail loud in dev) or return a discriminated error for the accessor guard?
6. **B6** — start with report-only CSP, or add a strict nonce-based CSP in this pass?

---

## Implementation record (revision after `cb9d1a9`)

Decisions taken: `APP_TIME_ZONE=Europe/Berlin`; DB probes were run with
`--allow-writes` on the configured branch (user-confirmed); B5 uses a throwing
guard; B6 ships report-only CSP.

| Item | Status | Where |
|---|---|---|
| H1.1 | ✅ `APP_TIME_ZONE=Europe/Berlin` | `.env` |
| H1.2 | ✅ dry-run script; **0 legacy rows**, so no backfill needed | `scripts/backfill-time-zone.ts` |
| H1.3 | ✅ host print + `--allow-writes` guard | `scripts/preflight.ts`, both probes |
| H2.1 | ✅ both probes pass, logs committed to the working tree | `scripts/*.post-fix.log`, `scripts/rate-limit-check.log` |
| H2.2 | ✅ `typecheck` / `verify` / `verify:db` | `package.json` |
| H2.3 | ✅ manual checklist | `docs/manual-qa.md` |
| H3.1 | ⚠️ SQL job added, **not scheduled** — needs Neon cron setup | `scripts/sql/rate-limit-cleanup.sql` |
| H3.2 | ✅ fail-open kept, hashed user logging | `src/lib/rate-limit.ts` |
| H3.3 | ✅ `eventCreate`, `commentDelete`, `checkIn` scopes applied | `rate-limit.ts` + 3 action files |
| H4.1 | ✅ no-op edits preserve `timeZone` (incl. null) | `src/app/events/[id]/edit/actions.ts` |
| H4.2 | ✅ compatibility re-export | `src/lib/events.ts` |
| H4.3 | ⏭️ skipped (optional; only needed for multi-zone no-backfill) | — |
| B1–B7 | ✅ all implemented | see file list in the diff |
| H6.1 | ✅ no history rewrite | — |
| H6.2 | ⏭️ plan docs left in place (no file move) | — |

Verification run: `npm run verify` (typecheck, scoped eslint, timezone probe,
production build) passes; `npm run lint` is clean; security headers confirmed
with `curl -I` against `next start`; both DB probes report all invariants held.

Remaining external actions: (1) schedule the rate-limit GC in Neon,
(2) set `APP_TIME_ZONE` in the deploy environment (it is gitignored in `.env`).
