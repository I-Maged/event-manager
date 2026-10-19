# Implementation Plan — Critical & High Findings

| | |
|---|---|
| Source plan | `critical-high-fix-plan.md` (repo root) |
| Repository | `D:\career-new\event-manager` |
| Reviewed revision | `c44ec52` ("UX polish"); working tree clean except the untracked plan doc |
| Stack | Next.js 16.4.0 (App Router, Turbopack, Cache Components, Partial Prefetching, React Compiler), React 19.3, Prisma 7 + `@prisma/adapter-neon`, `@neondatabase/auth` beta, Tailwind v4 |
| Scope | 5 fixes: C1/C2 (RSVP concurrency), H3 (client error paths), H2 (error boundaries + reporting), H1 (timezone), H4 (rate limiting) |
| Output | This plan only. No code has been changed. |

> **Plan-mode note:** this file is the deliverable. All code edits described below must be made by switching out of Plan mode / into an implementation agent. Steps are written so they can be executed top-to-bottom.

## How to read this plan

- Each phase has: **Goal**, **Evidence**, **Steps** (numbered), **Verification**, **Rollback**.
- Step IDs are stable (e.g. `1.3`) so they can be referenced in commits/PRs.
- Line numbers are from revision `c44ec52`. A few are corrected relative to the source plan where the docstrings/anchors differ (see Appendix A).
- The plan follows the source plan's sequencing but adds two refinements discovered while reading the code:
  - **Refinement A (Phase 4):** the source plan computes the hidden instant with `new Date(dateValue).toISOString()`, which uses the *browser* zone. That breaks the edit round-trip when an event was authored in a different zone. Use a `zonedTimeToUtc(wallClock, zone)` helper instead.
  - **Refinement B (Phase 1):** `updateEvent` never promotes from the wishlist when capacity is *raised*, so the "capacity increases via edit" promise in the `upsertRsvp` docstring is only honoured on the next unrelated RSVP mutation. Optional step 1.5 closes that gap inside the same locked transaction.

---

## Phase 0 — Pre-flight (do first, no code)

**Goal:** get a safe, reproducible baseline on a Neon dev branch and confirm the repro before any fix.

1. **Branch safety.** Create/point to a Neon **dev branch**. Never run writes against the primary branch. The repo already splits connections correctly:
   - runtime reads pooled `DATABASE_URL` (`src/db.ts:9-13`, `PrismaNeon({ connectionString: process.env.DATABASE_URL! })`);
   - Prisma CLI/migrations use `DATABASE_URL_UNPOOLED` (`prisma.config.ts:7`).
   - `.env` currently defines `DATABASE_URL`, `DATABASE_URL_POOLED`, `DATABASE_URL_UNPOOLED` (plus Neon Auth vars). Confirm which branch each points at.
2. **Freeze the baseline** (all three must be green before starting; record output):
   - `npx tsc --noEmit`
   - `npx eslint src/app src/components src/lib src/db.ts src/proxy.ts`
   - `npm run build`
   - Optional, known-broken: `npm run lint` repo-wide → ~226 errors all inside `src/generated/prisma` because `eslint.config.mjs` `globalIgnores` omits generated code. **Not** part of this plan; ticket separately (Appendix B).
3. **Capture the failing repro for Phase 1 first** (step 1.7). A fix without a failing repro is not a fix.
4. **Confirm the API facts** this plan depends on (already verified in the source plan against the installed versions; re-verify cheaply if the lockfile moves):
   - `error.tsx` receives `retry` (stable since `v16.3.0`); `reset` only clears state.
   - `global-error.tsx` replaces the root layout and must render its own `<html>`/`<body>` and re-import global CSS.
   - `Prisma.TransactionIsolationLevel.Serializable` exists in the generated client.
   - Interactive `tx.$queryRaw` / `tx.$executeRaw` are usable (denylist is only `$connect/$disconnect/$on/$use/$extends`).
   - `src/proxy.ts` + `export const config = { matcher }` is the current convention; `:id` params supported.
   - `export const instant = false` is the Cache Components opt-out for session-gated segments (already used across the app).

**Rollback:** none (read-only).

---

## Phase 1 — C1 + C2: make RSVP mutation atomic per event

**Goal:** a capped event can never be overbooked, and a waitlisted row can never be double-promoted, under concurrent writers.

**Evidence (bug):**
- `upsertRsvp` (`src/app/events/actions.ts:113-203`) does `count(GOING)` (`:131`) → `upsert` (`:140`), all inside `prisma.$transaction`.
- `promoteFromWishlist` (`src/app/events/actions.ts:58-82`) does `count(GOING)` (`:64`) → `findFirst(WAITLISTED, oldest)` (`:68`) → `update` (`:74`), N round-trips.
- `cancelRsvp` (`:243-323`) reads `findUnique` then `deleteMany` then promotes.
- `updateEvent` (`src/app/events/[id]/edit/actions.ts:35-56`) reads `count(GOING)` then later writes `maxAttendees` **outside** any transaction.
- Prisma interactive transactions run at PostgreSQL **READ COMMITTED**, so two transactions can both read "one seat free" and both commit.
- The docstring at `src/app/events/actions.ts:205-209` ("Runs in a transaction so concurrent GOING clicks cannot overbook") is **false**; that false claim is why this survived review.

### Steps

**1.1 — Enabler refactor: extract a DB core into `src/lib/rsvp.ts` (new file).**
Move the DB-only logic out of `events/actions.ts` so it can be driven by a script without cookies and unit-tested. The new module takes `userId` as an argument and performs **no** auth/redirect/revalidate/notification work.

Exports:
- `upsertRsvp(userId, eventId, status, attendeeName?)` → `{ ok: true; status; waitlistPosition } | { ok: false; error }`
- `cancelRsvpCore(userId, eventId)` → `{ ok: true; hadRsvp; promoted; eventTitle; eventDate; eventLocation; eventTimeZone; organizerId; organizerNotify } | { ok: false; error }`
- `notifyPromotions(...)` (moved, unchanged behaviour: best-effort, never throws)
- `lockEvent(tx, eventId)` (private helper, step 1.2)

`events/actions.ts` keeps thin wrappers: `requireUser()` → core → `revalidateEvent()` → notifications/revalidate. Keep the public action signatures and exported result types (`SetRsvpResult`, etc.) unchanged so no client changes are needed.

**1.2 — Add per-event serialization with a Postgres advisory lock.**
In `src/lib/rsvp.ts`:

```ts
type Tx = Prisma.TransactionClient;

/**
 * Serializes every RSVP mutation for one event.
 *
 * Postgres advisory locks are released when the transaction ends, so a writer
 * that reaches this line is guaranteed exclusive access for the rest of its
 * read-then-write sequence (count -> upsert -> promote). This is what makes the
 * cap check and the waitlist promotion correct under concurrency; plain
 * interactive transactions run at READ COMMITTED and do NOT provide this.
 *
 * `hashtext` maps the cuid to the int4 key the two-arg lock form expects;
 * a collision only over-serializes two unrelated events, which is harmless.
 */
async function lockEvent(tx: Tx, eventId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${eventId}), 0)`;
}
```

Call `lockEvent(tx, eventId)` as the **first statement** inside the transaction callback of:
- `upsertRsvp` (before `tx.event.findUnique`);
- `cancelRsvpCore` (before `tx.event.findUnique`).

Because the lock is taken before the first read, the later `count → upsert → promote` cannot interleave. Under READ COMMITTED each statement takes a fresh snapshot, so once the lock is granted the counts are authoritative. The lock is transaction-scoped and releases automatically on commit/rollback.
- **Alternative (documented, not chosen):** `prisma.$transaction(fn, { isolationLevel: 'Serializable' })` + retry on SQLSTATE `40001`. Advisory locks are preferred: no retry loops and only the RSVP path is affected.

**1.3 — Replace the promotion loop with one set-based statement.**
Replace the `findFirst`+`update` loop (`events/actions.ts:67-80`) with a single atomic claim executed per batch (default 200), which removes the double-promotion class and collapses N round-trips into 1 per 200 promotions (also addresses the unbounded loop):

```ts
async function promoteFromWishlist(
  tx: Tx,
  eventId: string,
  cap: number,
  batch = 200,
): Promise<string[]> {
  const promoted: string[] = [];
  for (;;) {
    const going = await tx.rSVP.count({ where: { eventId, status: 'GOING' } });
    const room = cap - going;
    if (room <= 0) break;

    const claimed = await tx.$queryRaw<{ userId: string }[]>`
      UPDATE "RSVP"
         SET status = 'GOING'::"RSVPStatus", "promotedAt" = now()
       WHERE id IN (
         SELECT id FROM "RSVP"
          WHERE "eventId" = ${eventId} AND status = 'WAITLISTED'::"RSVPStatus"
          ORDER BY "createdAt" ASC
          LIMIT ${Math.min(room, batch)}
       )
      RETURNING "userId"
    `;
    if (claimed.length === 0) break;
    promoted.push(...claimed.map((row) => row.userId));
    if (claimed.length < batch) break; // queue drained
  }
  return promoted;
}
```

**1.4 — Lock the capacity-shrink check in `updateEvent`.**
In `src/app/events/[id]/edit/actions.ts`, wrap the `count(GOING)` validation (`:35-44`) **and** the `prisma.event.update` (`:53`) in one transaction that takes the same lock first, so the stored `maxAttendees` cannot be lowered below a concurrently-growing GOING count:

```ts
await prisma.$transaction(async (tx) => {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${eventId}), 0)`;
  if (parsed.data.maxAttendees !== null) {
    const going = await tx.rSVP.count({ where: { eventId, status: 'GOING' } });
    if (parsed.data.maxAttendees < going) throw new CapacityError(going);
  }
  await tx.event.update({ where: { id: eventId }, data: { ...parsed.data, organizerName } });
});
```

Map the thrown `CapacityError` back to the existing `{ error: \`Capacity cannot be below the ${going} guests already going.\` }` return shape. Keep the pre-update snapshot (`before`) read where it is; the diff logic that follows is unchanged. Import the shared lock helper (export it from `src/lib/rsvp.ts`, or duplicate the one-liner with the same comment — prefer exporting `lockEvent`).

**1.5 — (Refinement B, optional but recommended) Promote on capacity increase, in the same locked transaction.**
Today `updateEvent` does not call `promoteFromWishlist`, so raising the cap only reconciles on the next unrelated RSVP mutation. Inside the step 1.4 transaction, after `tx.event.update`, when `parsed.data.maxAttendees != null` and capacity was raised, call `promoteFromWishlist(tx, eventId, parsed.data.maxAttendees)` and collect the promoted userIds. After the transaction commits, fan out `notifyUsers(... type: 'PROMOTION')` best-effort and `revalidatePath('/notifications')`, matching `upsertRsvp`'s pattern. Only do this if the team accepts the extra notification traffic from edits; otherwise skip and instead fix the stale docstring wording in step 1.6 to say "reconciled on the next RSVP mutation".

**1.6 — Fix the misleading docstrings.**
Rewrite the comments at `src/app/events/actions.ts:205-209` (`setRsvp`) and `:53-57` (`promoteFromWishlist`) to describe the advisory-lock guarantee and the single set-based claim. Leaving the false "a transaction prevents overbooking" claim in place is actively harmful.

**1.7 — Verification script `scripts/rsvp-concurrency.ts` (new file, run with the already-installed `tsx`).**

Run this **before** applying steps 1.1–1.4 to capture the `OVERBOOKED` failure as evidence; then again after, to show it passes.

```ts
import 'dotenv/config';
import { prisma } from '../src/db';
import { upsertRsvp } from '../src/lib/rsvp';

// cap = 1, 8 users race for it
const event = await prisma.event.create({
  data: { title: 'probe', description: 'probe', location: 'probe', date: future, maxAttendees: 1, userId: 'probe-org' },
});
await Promise.all(users.map((u) => upsertRsvp(u, event.id, 'GOING', `Guest ${u}`)));

const going = await prisma.rSVP.count({ where: { eventId: event.id, status: 'GOING' } });
if (going !== 1) throw new Error(`OVERBOOKED: ${going} GOING with cap 1`);

// then: raise cap to 3 and assert exactly 3 promoted, 3 PROMOTION rows, no duplicates
// finally: prisma.rSVP.deleteMany({ where: { eventId } }); prisma.event.delete(...) to keep the branch tidy
```

Run: `npx tsx scripts/rsvp-concurrency.ts`
Save the pre-fix `OVERBOOKED` output as evidence (Definition of Done #1). Clean up probe rows by `eventId` so the dev branch stays tidy.

**1.8 — Regression checks.** `npx tsc --noEmit`, `npx eslint src/app src/components src/lib src/db.ts src/proxy.ts`, `npm run build`. Manually: RSVP going/maybe/can't-go, join wishlist on a full event, remove RSVP, confirm a promotion banner appears and notifications are not duplicated.

**Rollback:** code-only; revert the commits. The change mutates no data.

---

## Phase 2 — H3: give every client action call a failure path

**Goal:** no `await` on a server action/`authClient` can leave a permanently disabled control or swallow a failure.

**Evidence (missing `try/catch` / `finally`):**
`src/components/RsvpControls.tsx:65,79,93,110` · `src/app/invite/[token]/AcceptInviteButton.tsx:13-35` · `src/app/wishlist/WishlistButtons.tsx:13-17,35-39` · `src/app/notifications/NotificationButtons.tsx:12-20,37-43` · `src/app/events/[id]/edit/DeleteEventButton.tsx:11-15` · `src/components/SignOutButton.tsx:11-16` · `src/components/GoogleSignInButton.tsx:10-23` · `src/app/auth/sign-in/page.tsx:14-30` · `src/app/auth/sign-up/page.tsx:14-46`.
Worst case: `RsvpControls.handleDismissPromotion` (`:110-115`) — a throw leaves `pending = 'dismiss'`, disabling **every** RSVP button.

Reference (already-correct) shape to copy: `CommentForm.tsx:22-33`, `CommentDeleteButton.tsx:14-21`, `RosterCheckInButton.tsx:24-37`, `InviteLinkManager.tsx:43-62`.

### Steps

**2.1 — Add the shared hook `src/lib/useActionFeedback.ts` (new file).**

```ts
'use client';
import { useCallback, useState } from 'react';

export function useActionFeedback() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async <T,>(fn: () => Promise<T>, fallback = 'Something went wrong. Please retry.'): Promise<T | null> => {
      setError(null);
      setPending(true);
      try {
        return await fn();
      } catch {
        setError(fallback);
        return null;
      } finally {
        setPending(false); // always runs, even when the action rejects
      }
    },
    [],
  );

  return { pending, error, setError, run };
}
```

**2.2 — Add a redirect detector** (used in 2.3/2.4). Server actions call `redirect('/auth/sign-in')` via `requireUser()`/`requireOrganizer()` (`src/app/events/actions.ts:21-45`). Next models this as a control-flow exception with a `digest` of `NEXT_REDIRECT` (and `NEXT_NOT_FOUND` for `notFound()`). The hook must **not** blanket-swallow those — a session-expiry redirect must still navigate, not look like a network error. Add to the hook (or a small `src/lib/action-errors.ts`):

```ts
export function isFrameworkControlFlow(error: unknown): boolean {
  const digest = (error as { digest?: unknown })?.digest;
  return typeof digest === 'string' && (digest.startsWith('NEXT_REDIRECT') || digest === 'NEXT_NOT_FOUND');
}
```

In `run`, catch, and if `isFrameworkControlFlow(e)` re-throw; otherwise set the error. Verify empirically in step 2.5.

**2.3 — Apply the hook where there is a single pending flag.**
- `AcceptInviteButton.tsx` (`handleAccept`): keep `message`/`isError`/`eventId`; wrap the `acceptInvite` call in `run(...)`, return early on `null`.
- `WishlistButtons.tsx`: `LeaveWishlistButton` (`:13-17`) and `DismissPromotionButton` (`:35-39`) — wrap `cancelRsvp`/`dismissPromotion`; `LeaveWishlistButton` should surface a failure (currently it has no error UI) — add a small inline `role="alert"` message.
- `NotificationButtons.tsx`: `MarkReadButton` (`:12-20`), `MarkAllReadButton` (`:37-43`) — replace the manual `try/finally` with `run` + render `error`.
- `DeleteEventButton.tsx` (`:11-15`): wrap `deleteEvent(formData)`; the action ends in `redirect('/events')`, so re-throw framework control flow (2.2). On real failure, show an inline error instead of a stuck "Deleting…".
- `SignOutButton.tsx` (`:11-16`): wrap `authClient.signOut()`; on failure show an error and reset pending (do not `router.push`).
- `GoogleSignInButton.tsx` (`:10-23`): wrap `authClient.signIn.social`; a thrown (not returned) error must set `error` and clear pending.
- `auth/sign-in/page.tsx` (`:14-30`) and `auth/sign-up/page.tsx` (`:14-46`): wrap the `authClient.signIn.email` / `signUp.email` calls; on throw set a generic error and clear `isPending` (currently a throw leaves the button disabled forever).

**2.4 — Keep bespoke state in `RsvpControls.tsx`, add `try/catch/finally`.**
`RsvpControls` tracks 8 pending keys, so it does not use the hook as-is. Wrap the body of `handleSet` (`:65`), `handleJoinWishlist` (`:79`), `handleCancel` (`:93`), `handleDismissPromotion` (`:110`) so that:
- `setPending(...)` is always followed by a `finally { setPending(null) }`;
- a rejection sets `message` + `isError` (or reverts the dismiss);
- a framework control-flow error (2.2) is re-thrown, not shown as an error.
`handleNotifyChange` (`:117-125`) is already safe (optimistic + `catch` revert) — leave it.

**2.5 — Verify the redirect interaction explicitly.**
Delete the session cookie, click "Going": the browser must land on `/auth/sign-in` **without** a spurious error banner. If the redirect surfaces as a rejection in the new catch and is swallowed, session expiry would look like a network failure — that is the failure mode step 2.2 guards against. Test both a thrown action (drop the network / kill the DB connection) and a rejected promise.

**Rollback:** additive; revert the touched files.

---

## Phase 3 — H2: error boundaries + server error reporting

**Goal:** a server/render error shows a recoverable UI instead of Next's default page, and production has a server-side log to correlate `error.digest` with.

**Evidence:** no `error.tsx`, `global-error.tsx`, or `instrumentation.ts` exists anywhere under `src/` (verified by glob). `/events/[id]/page.tsx:387-429` streams four `<Suspense>` sections with no recovery affordance.

### Steps

**3.1 — Segment boundary `src/app/error.tsx` (new file).**
Use `retry` (stable in `v16.3.0`), **not** `reset` (which clears state without re-fetching). Copy the source plan's component, matching repo styles (`.card`, `.btn-primary`, `text-muted`):

```tsx
'use client';
import { useEffect } from 'react';

export default function Error({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return (
    <div className="card p-8 text-center space-y-4 max-w-xl mx-auto">
      <h1 className="text-2xl font-bold">Something went wrong</h1>
      <p className="text-muted text-sm">We couldn&apos;t load this page. It may be temporary.</p>
      <button type="button" onClick={() => retry()} className="btn-primary text-sm">Try again</button>
    </div>
  );
}
```

**3.2 — `src/app/global-error.tsx` (new file).**
Must render its own `<html>`/`<body>` and **does not** inherit the root layout's global styles — import `../globals.css` relative to the file (`src/app/globals.css`) and keep markup minimal so `.card`/`.btn-primary` are styled. No `metadata`/`generateMetadata` export is allowed here (client component). Same `retry` button.

**3.3 — Detail-segment boundary `src/app/events/[id]/error.tsx` (new file).**
So a roster/comment read failure degrades the segment instead of 500-ing the whole route. **State the trade-off honestly in the PR:** a segment `error.tsx` replaces the whole segment, not just the failed `<Suspense>` section. True per-section isolation needs a client error boundary per section (the class pattern in `node_modules/next/dist/docs/.../error.md:207-274`, or the `catchError` API at `error.md:281-335`) — optional follow-up, not part of this fix.

**3.4 — `src/instrumentation.ts` (new file; `src/` is the app root here).**

```ts
import type { Instrumentation } from 'next';

export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  console.error('[request error]', {
    message: err instanceof Error ? err.message : String(err),
    digest: typeof err === 'object' && err !== null && 'digest' in err ? String(err.digest) : undefined,
    path: request.path,
    routeType: context.routeType, // 'render' | 'action' | 'route' | 'proxy'
  });
};
```

Without this there is nothing to correlate `error.digest` against in production. (Docs: `.../03-file-conventions/instrumentation.md:36-123`.)

**3.5 — Verify.** Temporarily point the dev-branch `DATABASE_URL` at a bad host, load `/events` → the boundary must render rather than a raw 500; restore the URL and confirm "Try again" recovers. Confirm `onRequestError` logs one structured line per failure. `npx tsc --noEmit` + `npm run build` must stay clean.

**Rollback:** additive; delete the new files.

---

## Phase 4 — H1: timezone correctness

**Goal:** the wall-clock time an organizer types is the wall-clock time everyone sees, and browse day-boundaries are computed in a known zone.

**Evidence (bug):**
- `<input type="datetime-local">` submits `2026-10-20T18:00`; `parseEventForm` does `new Date(dateRaw)` (`src/lib/event-validation.ts:52`), parsed in the **server's** zone.
- `formatEventDate` (`src/lib/events.ts:485-494`) and `toDatetimeLocalValue` (`src/lib/event-validation.ts:75-81`) render with no `timeZone`.
- `startOfDay`/`whenDateRange` (`src/lib/events.ts:75-89`) and `startsInLabel` (`:295-309`) anchor "Today/This week" to server-local midnight.
- Self-consistent in local dev (server TZ == user TZ), wrong in production. A UTC+3 organizer's 18:00 event is stored as 18:00 UTC — three hours off.

### Decision required (confirm before implementing)

- **A — store the author's zone (recommended).** Add `Event.timeZone`, capture the browser IANA zone at create/edit, render every time in that zone. Deterministic, correct for a distributed audience, works in notification bodies and ICS, no client JS for display.
- **B — one app-wide zone.** Env var only, no schema change, but every event authored elsewhere displays wrong. Cheapest, least correct.
- **C — render in each viewer's browser zone.** Correct per viewer, but needs client components at every display site, reintroduces the hydration dance the codebase deliberately avoids, and cannot be used in stored notification bodies.

The steps below implement **A**. If B is chosen, skip 4.1/4.2/4.3 and inject `APP_TIME_ZONE` at the formatting sites; if C, treat as a separate design spike.

### Steps

**4.1 — Schema (`prisma/schema.prisma`).**

```prisma
model Event {
  /// IANA zone the organizer authored `date` in (e.g. "Europe/Berlin").
  /// Null for rows created before this fix -> render with APP_TIME_ZONE.
  timeZone String?
}
```
Run `npx prisma migrate dev --name add_event_time_zone` (uses `DATABASE_URL_UNPOOLED`). Existing rows stay `null` → fall back to `APP_TIME_ZONE` (default `'UTC'`). No backfill. Add `APP_TIME_ZONE` to `.env`/deploy env (document default).

**4.2 — New `src/lib/time.ts` (new file).**
Export:
- `DEFAULT_TIME_ZONE = process.env.APP_TIME_ZONE?.trim() || 'UTC'`
- `isValidTimeZone(tz)` — try/catch around `new Intl.DateTimeFormat('en-US', { timeZone: tz })`.
- `resolveTimeZone(tz)` — returns `tz` when valid, else `DEFAULT_TIME_ZONE`.
- `formatEventDate(date, timeZone = DEFAULT_TIME_ZONE)` — `toLocaleString('en-US', { weekday, month, day, year, hour, minute, timeZone })`.
- `toDatetimeLocalValue(date, timeZone = DEFAULT_TIME_ZONE)` — via `Intl.DateTimeFormat('en-CA', { ..., hourCycle: 'h23' }).formatToParts()`, joining `year-month-dayThh:mm` (use `hourCycle: 'h23'`, not `hour12: false`, to avoid a `24:00` edge).
- `zonedTimeToUtc(local, timeZone)` — inverse of the above (Refinement A). Convert the wall-clock `YYYY-MM-DDTHH:mm` to the true instant:

```ts
function zoneOffsetMs(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(date);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second')) - date.getTime();
}

export function zonedTimeToUtc(local: string, timeZone: string): Date {
  const naive = new Date(`${local}:00Z`);          // pretend the wall clock is UTC
  if (Number.isNaN(naive.getTime())) return new Date(NaN);
  const offset = zoneOffsetMs(naive, timeZone);
  return new Date(naive.getTime() - offset);       // second pass if you want to tighten DST edges
}
```

- `startOfDayIn(date, timeZone = DEFAULT_TIME_ZONE)` — take `formatToParts` of `date` in zone, rebuild `YYYY-MM-DDT00:00`, run it through `zonedTimeToUtc`.
- Keep `formatEventDate` import-compatible: **re-export** it from `src/lib/events.ts` (`export { formatEventDate } from '@/lib/time';` and delete the old body) so the ~10 existing `@/lib/events` imports keep working with zero churn.
- Document the accepted ±1 h DST edge at fall-back (ambiguous local time → earlier instant) in the helper JSDoc.

**4.3 — Capture the instant + zone on submit.**
Both forms are already client components: `src/app/events/new/page.tsx` and `src/app/events/[id]/edit/EditEventForm.tsx`.

- Create form: make `dateValue` controlled, detect the browser zone once (`useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone)`), render hidden `name="dateUtc"` = `zonedTimeToUtc(dateValue, browserZone).toISOString()` and hidden `name="timeZone"` = browserZone.
- Edit form: prefill `dateValue = toDatetimeLocalValue(event.date, resolveTimeZone(event.timeZone))` (passed from `src/app/events/[id]/edit/page.tsx:35`), keep hidden `timeZone = resolveTimeZone(event.timeZone)` so the zone is **preserved** across edits, and hidden `dateUtc` computed with `zonedTimeToUtc(dateValue, thatZone)` — **not** `new Date(dateValue)` (Refinement A: this is what makes the edit round-trip correct when the organizer's browser zone differs from the event's zone).
- `parseEventForm` (`src/lib/event-validation.ts:52-56`): prefer `dateUtc` (`new Date(dateUtcRaw)`, an unambiguous ISO instant); fall back to `new Date(dateRaw)` only when absent (no-JS), and **document** that the fallback assumes the server zone. Read `timeZone` and pass it through `isValidTimeZone` → `null` when invalid. Add `timeZone: string | null` to `ParsedEventForm.data`; `createEvent`/`updateEvent` spread it into the Prisma write.

**4.4 — Thread the zone through every display site.**
`getOrganizerEvents` / `getUpcomingRsvps` / `getEventById` return full `Event` rows, so `timeZone` flows automatically; the work is passing it to `formatEventDate` and adding `eventTimeZone` to the notification payload builders.

| # | Site | Change |
|---|---|---|
| 1 | `src/lib/events.ts:485-494` | move/`re-export` `formatEventDate`, now zone-aware |
| 2 | `src/lib/events.ts:75-89` | `startOfDay`/`whenDateRange` → `startOfDayIn(now, DEFAULT_TIME_ZONE)`; document that browse "Today/This week" anchor to `APP_TIME_ZONE` |
| 3 | `src/lib/events.ts:295-309` | `startsInLabel(date, timeZone)` compares `startOfDayIn` in-zone |
| 4 | `src/app/events/actions.ts:104` | promotion body: pass `event.timeZone` (add to `notifyPromotions`) |
| 5 | `src/app/events/actions.ts:312` | "left" body: pass `event.timeZone` |
| 6 | `src/app/events/[id]/edit/actions.ts:69` | `formatEventDate(parsed.data.date, parsed.data.timeZone)` |
| 7 | `src/app/events/[id]/edit/actions.ts:138` | `formatEventDate(event.date, event.timeZone)` |
| 8 | `src/app/events/[id]/page.tsx:350` | `formatEventDate(event.date, event.timeZone)` (also consider `:132,184,272` date-only stamps) |
| 9 | `src/components/EventCard.tsx:60` | pass `event.timeZone` |
| 10 | `src/components/OrganizerEventCard.tsx:50` | pass `event.timeZone` |
| 11 | `src/app/notifications/page.tsx:91` | pass the notification's event `timeZone` (extend the `getNotifications` select to include `timeZone`) |
| 12 | `src/app/wishlist/page.tsx:69,96` | pass each event's `timeZone` |
| 13 | `src/app/invite/[token]/page.tsx:55,70` | pass `event.timeZone` |
| 14 | `src/app/notifications/UpcomingWidget.tsx:38` | pass `event.timeZone`; `startsInLabel(event.date, event.timeZone)` |
| 15 | `src/app/events/[id]/edit/page.tsx:35` | `toDatetimeLocalValue(event.date, resolveTimeZone(event.timeZone))` |

No change needed for `src/lib/calendar.ts` / `src/app/api/events/[id]/calendar/route.ts` — ICS/Google Calendar already use UTC instants, which is correct.
While here (minor finding B12): `WHEN_OPTIONS` says "This week"/"This month" (`src/lib/discovery.ts:40-41`) but `whenDateRange` computes "next 7/30 days". Fix the label or the math and note it in the PR.

**4.5 — Verify.**
- `tsx` assertion: `formatEventDate(new Date('2026-10-20T18:00:00Z'), 'America/New_York')` equals the expected `Oct 20 ... 2:00 PM`.
- Round-trip: `zonedTimeToUtc(toDatetimeLocalValue(d, tz), tz).toISOString() === d.toISOString()` for a matrix of zones (`UTC`, `America/New_York`, `Europe/Berlin`, `Asia/Tokyo`) including a DST-transition date.
- Set the browser to a non-server zone (or override `APP_TIME_ZONE`), create an event, confirm the detail page and edit form show the wall clock the organizer typed; edit it once and confirm it does not shift.

**Rollback:** additive column; revert code and `prisma migrate` drop the column (stored instants are unaffected — no data loss).

---

## Phase 5 — H4: rate limiting

**Goal:** bound per-user write amplification (notification fan-out) without a Redis dependency.

**Evidence:** no rate limiting anywhere. One authenticated user can toggle RSVP indefinitely; `addComment` fans out up to `NOTIFY_RECIPIENT_CAP = 20` notifications (`src/app/events/[id]/comments/actions.ts:9,58-81`); each RSVP change can fan out promotions plus an organizer "left" notice. No Redis in this stack → use Postgres (Neon) as the counter store.

### Steps

**5.1 — Model (`prisma/schema.prisma`).**

```prisma
model RateLimit {
  key         String   @id
  count       Int      @default(0)
  windowStart DateTime @default(now())
}
```
`npx prisma migrate dev --name add_rate_limit` (uses `DATABASE_URL_UNPOOLED`).

**5.2 — `src/lib/rate-limit.ts` (new file) — one atomic statement, no read-then-write race.**

```ts
export async function consume(key: string, limit: number, windowMs: number): Promise<boolean> {
  const rows = await prisma.$queryRaw<{ count: number }[]>`
    INSERT INTO "RateLimit" ("key", "count", "windowStart")
    VALUES (${key}, 1, now())
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE
        WHEN "RateLimit"."windowStart" < now() - (${windowMs}::int * interval '1 millisecond')
        THEN 1 ELSE "RateLimit"."count" + 1 END,
      "windowStart" = CASE
        WHEN "RateLimit"."windowStart" < now() - (${windowMs}::int * interval '1 millisecond')
        THEN now() ELSE "RateLimit"."windowStart" END
    RETURNING "count"
  `;
  return (rows[0]?.count ?? 1) <= limit;
}
```

`key` is the primary key, so `ON CONFLICT ("key")` is valid.

**5.3 — Apply after the auth guard, returning the existing `{ ok: false, error }` shape (no UI changes needed).**

| Action | Location | Key | Limit |
|---|---|---|---|
| `addComment` | `src/app/events/[id]/comments/actions.ts:32` | `comment:{userId}` | 5 / 60 s |
| `setRsvp` | `src/app/events/actions.ts:210` | `rsvp:{userId}` | 30 / 60 s |
| `joinWishlist` | `src/app/events/actions.ts:226` | `rsvp:{userId}` | 30 / 60 s |
| `cancelRsvp` | `src/app/events/actions.ts:243` | `rsvp:{userId}` | 30 / 60 s |
| `createInviteLink` | `src/app/events/actions.ts:369` | `invite:{userId}` | 10 / 60 s |
| `regenerateInviteLink` | `src/app/events/actions.ts:389` | `invite:{userId}` | 10 / 60 s |
| `acceptInvite` | `src/app/events/actions.ts:427` | `accept:{userId}` | 10 / 60 s |

`addComment`'s 20-recipient fan-out is the amplification path, so it gets the tightest limit. Return e.g. `{ ok: false, error: 'Too many requests — please wait a moment.' }`.

**5.4 — Cleanup.** Add opportunistic cleanup of stale `RateLimit` rows (delete-where `windowStart` older than a day), run lazily inside `consume` (e.g. 1-in-N calls) or via a Neon scheduled job — function triggers/cron are covered by the `neon` skill if you want it out of the request path. Document the choice.

**5.5 — Verify.** `tsx` script calling `consume` 60× and asserting the 6th call fails at `limit = 5`. Manual: click "Post comment" rapidly and confirm the inline error surfaces instead of a silent fan-out.

**Rollback:** drop the table/column via a migration; revert code.

---

## Execution order & PR sequencing

1. Phase 0 (baseline + failing repro).
2. **PR 1:** Phase 1 + Phase 2 (correctness + UX; no migration).
3. **PR 2:** Phase 3 (small, additive).
4. **PR 3:** Phase 4 (needs `add_event_time_zone` migration + the timezone-model decision).
5. **PR 4:** Phase 5 (needs `add_rate_limit` migration).

Estimated total ≈ 12 h per the source plan (Phase 1 ~3–4 h, Phase 2 ~1.5 h, Phase 3 ~1 h, Phase 4 ~4–6 h, Phase 5 ~2 h).

## Definition of done

1. `npx tsx scripts/rsvp-concurrency.ts` passes, and the pre-fix `OVERBOOKED` output is saved as evidence.
2. `npx tsc --noEmit` clean; `npx eslint src/app src/components src/lib src/db.ts src/proxy.ts` clean; `npm run build` succeeds.
3. Manual pass:
   - session-expiry redirect shows no spurious error banner;
   - a DB outage shows the error boundary with "Try again" that recovers;
   - a past-date RSVP is rejected;
   - an event created in a non-server timezone displays the wall clock the organizer typed, and an edit does not shift it;
   - rapid clicking yields the rate-limit message instead of a silent write storm.
4. Two migrations (`add_event_time_zone`, `add_rate_limit`) applied and reviewed on the dev branch before touching the primary branch.

## Open decisions to confirm before coding

1. **Timezone model — A, B, or C?** Recommendation: **A** (`Event.timeZone` + browser-captured zone). Cost: one schema column + ~15 display sites. B is cheaper but wrong for distributed users.
2. **Phase 1 step 1.5** — do we promote from the wishlist on capacity increase (extra notification traffic on edits), or only fix the docstring wording?
3. **Rate-limit store** — accept Postgres/Neon counters, or invest in a hosted limiter? Postgres is chosen because the stack has no Redis.
4. **PR granularity** — the 4-PR split above, or one branch?

---

## Appendix A — line-number corrections vs. the source plan

- `upsertRsvp` transaction actually spans `src/app/events/actions.ts:113-203` (the source plan cites `:119-152` for the transaction callback; `:119` is `prisma.$transaction`).
- `promoteFromWishlist` is `:58-82` (matches).
- `cancelRsvp` transaction is `:248` (matches).
- False docstring for the transaction guarantee is `:205-209` (`setRsvp`), not `:53-57`; `:53-57` is the `promoteFromWishlist` JSDoc.
- `SETTABLE_STATUSES` and `SetRsvpResult` already live in `events/actions.ts:14-19`; keep them exported from there so `RsvpControls.tsx:11` and `AcceptInviteButton.tsx:5` imports are untouched.
- `requireUser()` redirects at `events/actions.ts:24,31`; `requireOrganizer()` at `:43` and `edit/actions.ts:14,19`.
- Phase 4 display sites confirmed exactly at the lines listed in step 4.4.

## Appendix B — out of scope (ticket separately)

N+1 in `getUserWishlist` (`src/lib/events.ts:405-421`); redundant per-request reads on the event detail page (3× `getEventById`, 2× `getRsvpCounts` → wrap in React `cache()`); `InviteLinkManager` hydration mismatch (`src/app/events/[id]/InviteLinkManager.tsx:22-26`); notification unread-count mismatch (`notifications/page.tsx:32` vs `lib/notifications.ts:16-21`); unauthorized-by-omission data accessors (`getAttendees`/`getWishlist`/`getComments`); missing security headers; `src/generated` missing from `eslint.config.mjs` `globalIgnores`.
