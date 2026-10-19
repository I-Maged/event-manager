# Fix Plan — Critical & High findings

| | |
|---|---|
| Repository | `D:\career-new\event-manager` |
| Reviewed revision | `c44ec52` ("UX polish"), working tree clean |
| Scope | Whole app source (`src/` minus `src/generated`), `prisma/schema.prisma`, `src/proxy.ts`, build config |
| Stack | Next.js 16.4.0 (App Router, Turbopack, Cache Components + Partial Prefetching + React Compiler), React 19.3, Prisma 7 + `@prisma/adapter-neon`, `@neondatabase/auth` beta, Tailwind v4 |
| Status | Plan only — nothing implemented |

## Baseline evidence (verified, not inferred)

- `npx tsc --noEmit` → clean.
- `npx eslint src/app src/components src/lib src/db.ts src/proxy.ts` → clean.
- `npm run build` → succeeds; routes classify as expected (`ƒ` dynamic for `/events`, `/my-events`, `/notifications`, `/wishlist`, `/invite/[token]`; `◐` partial for `/`, `/account`, `/events/[id]`).
- `npm run lint` (repo-wide) → **226 errors / 54 warnings**, all inside `src/generated/prisma` (generated code is not in `globalIgnores`). Unrelated to this plan but a real repo-hygiene issue.

API facts confirmed against this repo's installed versions (AGENTS.md warns this Next version differs from training data):

- `error.tsx` receives **`retry`** (`v16.3.0` made it stable); `reset` only clears state without re-fetching.
- `global-error.tsx` must render its own `<html>`/`<body>` and does **not** inherit the root layout's global styles.
- `Prisma.TransactionIsolationLevel.Serializable` exists in the generated client.
- The interactive-transaction client denylist is only `["$connect","$disconnect","$on","$use","$extends"]`, so `tx.$queryRaw` / `tx.$executeRaw` **are** usable inside `$transaction`.
- `proxy.ts` + `export const config = { matcher }` is the current convention (Middleware was renamed to Proxy in Next 16); `:id` named params are supported.
- `export const instant = false` is the correct Cache Components opt-out for session-gated segments.
- `@neondatabase/auth` `getSession()` is cached (60 s) and de-duplicates concurrent calls, so multiple `getSession()` calls per request are not a hot path.

## Sequencing

| Phase | Fix | Files touched | Schema change | Est. |
|---|---|---|---|---|
| 1 | C1 + C2 — serialize RSVP mutations | `src/lib/rsvp.ts` (new), `events/actions.ts`, `edit/actions.ts`, `scripts/rsvp-concurrency.ts` (new) | none | ~3–4 h |
| 2 | H3 — client action error paths | `src/lib/useActionFeedback.ts` (new) + 8 components/pages | none | ~1.5 h |
| 3 | H2 — error boundaries + error reporting | `app/error.tsx`, `app/global-error.tsx`, `app/events/[id]/error.tsx`, `src/instrumentation.ts` | none | ~1 h |
| 4 | H1 — timezone correctness | `lib/time.ts` (new), schema, `event-validation.ts`, forms, ~14 display sites | `Event.timeZone` | ~4–6 h |
| 5 | H4 — rate limiting | `lib/rate-limit.ts` (new), schema, 4 action modules | `RateLimit` model | ~2 h |

Rationale: Phase 1 is the only data-integrity bug and needs no migration. Phase 2 is pure client code. Phase 3 is additive. Phases 4 and 5 each need a migration and a decision.

---

## Phase 0 — Pre-flight

1. Work against a **Neon dev branch**, never the primary branch. The project already splits connections correctly: runtime uses pooled `DATABASE_URL` (`src/db.ts:11`), migrations use `DATABASE_URL_UNPOOLED` (`prisma.config.ts:7`).
2. Confirm the target branch before running anything that writes — the concurrency probe inserts rows.
3. Capture the baseline: `npx tsc --noEmit`, `npx eslint src/app src/components src/lib src/db.ts src/proxy.ts`, `npm run build`.

---

## Phase 1 — C1 + C2: make RSVP mutation atomic per event

### Problem recap

`upsertRsvp` (`src/app/events/actions.ts:119–152`) does `count(GOING)` → `upsert(status: GOING)`, and `promoteFromWishlist` (`:58–82`) does `count(GOING)` → `findFirst(WAITLISTED, oldest)` → `update`. Prisma interactive transactions run at PostgreSQL's default **READ COMMITTED**, so two concurrent writers can both read "one seat free" and both commit. Two failure modes:

- **Overbooking** — more `GOING` rows than `maxAttendees`.
- **Double promotion** — two transactions claim the same waitlisted row, each incrementing its own local counter → duplicate `PROMOTION` notifications and an event left under-filled while reporting full.

The docstrings at `:53–57` and `:205–209` explicitly claim protection that does not exist; that false claim is why this survived review.

### 1a. Enabler refactor

Move the DB core out of `src/app/events/actions.ts` into a new `src/lib/rsvp.ts` that takes `userId` as an argument and performs **no** auth/redirect/revalidate work: `upsertRsvp`, `promoteFromWishlist`, `cancelRsvpCore`, `notifyPromotions`. `events/actions.ts` keeps thin wrappers (`requireUser()` → core → `revalidateEvent` → notifications).

Required for the probe script to drive the core without cookies, and it is testable. Also shrinks the 500-line action module.

### 1b. Per-event serialization

```ts
// src/lib/rsvp.ts
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

Call it as the **first statement** inside the transaction callback of:

- `upsertRsvp` (`events/actions.ts:119`) — before `tx.event.findUnique`
- `cancelRsvp` (`:248`) — before `tx.event.findUnique`

Because the lock is taken before the first read, the later count → upsert → promote sequence cannot interleave. Under READ COMMITTED each statement takes a fresh snapshot, so once the lock is granted the counts are authoritative. The lock is transaction-scoped and releases automatically on commit/rollback.

Alternative if advisory locks are unwanted: `prisma.$transaction(fn, { isolationLevel: 'Serializable' })` plus retry on SQLSTATE `40001`. Advisory locks are preferred here because they avoid retry loops and touch only the RSVP path.

### 1c. Replace the promotion loop with one set-based statement

Current code issues `findFirst` + `update` per promoted row, up to the 100,000 capacity ceiling allowed at `event-validation.ts:63–64`.

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

    // Single atomic claim: nobody else can mutate this queue while the caller
    // holds the per-event advisory lock.
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

Claiming is now a single statement executed under the lock, which removes the double-promotion class of bug and collapses N round trips into 1 per 200 promotions (also addresses M2, the unbounded loop).

### 1d. Lock the capacity-shrink check

`updateEvent` (`edit/actions.ts:35–44`) reads `count(GOING)` and later writes `maxAttendees` outside any transaction — the same shape, and `maxAttendees` is the input the promotion logic trusts. Wrap both in one transaction that takes the same lock first:

```ts
await prisma.$transaction(async (tx) => {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${eventId}), 0)`;
  // ...count(GOING) validation and tx.event.update(...)
});
```

### 1e. Fix the misleading comments

Rewrite `events/actions.ts:205–209` and `:53–57` to describe the advisory lock. Leaving the false claim in place is actively harmful.

### 1f. Verification

`scripts/rsvp-concurrency.ts`, run with the already-installed `tsx`:

```
npx tsx scripts/rsvp-concurrency.ts
```

```ts
import 'dotenv/config';
import { prisma } from '../src/db';
import { upsertRsvp } from '../src/lib/rsvp';

// cap = 1, 8 users race for it
const event = await prisma.event.create({ data: { /* ... */ maxAttendees: 1, date: future } });
await Promise.all(users.map((u) => upsertRsvp(u, event.id, 'GOING', `Guest ${u}`)));

const going = await prisma.rSVP.count({ where: { eventId: event.id, status: 'GOING' } });
if (going !== 1) throw new Error(`OVERBOOKED: ${going} GOING with cap 1`);

// then: raise cap to 3 and assert exactly 3 promoted, 3 PROMOTION rows, no duplicates
```

**Run it before applying the fix first** — it must fail with `OVERBOOKED`. A fix without a failing repro is not a fix. Clean up probe rows (`deleteMany` by event) so the dev branch stays tidy.

**Rollback:** code-only; revert the commits. The change itself mutates no data.

---

## Phase 2 — H3: give every client action call a failure path

### Problem recap

These `await` a server action or `authClient` call with **no `try/catch`**, so a thrown action or a dropped network rejects the promise and the `setPending(false)` on the next line never runs:

`components/RsvpControls.tsx:65,79,93,110` · `app/invite/[token]/AcceptInviteButton.tsx:13–35` · `app/wishlist/WishlistButtons.tsx:13–17,35–39` · `app/notifications/NotificationButtons.tsx:12–20,37–43` · `app/events/[id]/edit/DeleteEventButton.tsx:11–15` · `components/SignOutButton.tsx:11–16` · `components/GoogleSignInButton.tsx:10–23` · `app/auth/sign-in/page.tsx:14–30` · `app/auth/sign-up/page.tsx:14–46`

Impact: permanently disabled controls ("Saving…"), silently swallowed sign-in/sign-up/Google failures, unhandled promise rejections. `RsvpControls.handleDismissPromotion` is worst — a throw leaves `pending = 'dismiss'`, disabling every RSVP button.

The correct pattern already exists and is the reference shape: `CommentForm:22–33`, `CommentDeleteButton:14–21`, `RosterCheckInButton:24–37`, `InviteLinkManager:43–62`.

### 2a. Shared hook

```ts
// src/lib/useActionFeedback.ts
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

### 2b. Apply it

- **Hook applies** (single pending flag): `AcceptInviteButton.tsx:13–35`, `WishlistButtons.tsx:13–17` and `:35–39`, `NotificationButtons.tsx:12–20` and `:37–43`, `DeleteEventButton.tsx:11–15`, `SignOutButton.tsx:11–16`, `GoogleSignInButton.tsx:10–23`, `auth/sign-in/page.tsx:14–30`, `auth/sign-up/page.tsx:14–46`.
- **Keep bespoke state, add `try/catch/finally`** (`RsvpControls` tracks 8 pending keys): `handleSet:65`, `handleJoinWishlist:79`, `handleCancel:93`, `handleDismissPromotion:110`.
- Existing correct handlers stay untouched.

### 2c. Interaction to verify explicitly

`requireUser()` / `requireOrganizer()` call `redirect('/auth/sign-in')`, documented as "a framework handled control-flow exception". Verify by deleting the session cookie and clicking "Going": the user must land on `/auth/sign-in` **without** a spurious error banner. If a redirect does surface as a rejection in the new `catch`, detect its digest and re-throw/ignore — do not blanket-swallow it, or session expiry will look like a network failure.

**Rollback:** additive; revert the files.

---

## Phase 3 — H2: error boundaries + server error reporting

### Problem recap

No `error.tsx` or `global-error.tsx` exists anywhere (verified). Any thrown error in a server component or action — Neon cold start, connection reset, malformed row — falls through to Next's default error page. `/events/[id]` streams four `<Suspense>` sections (`page.tsx:387–429`) with no recovery affordance.

### 3a. Segment boundary — `src/app/error.tsx`

```tsx
'use client';

import { useEffect } from 'react';

export default function Error({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="card p-8 text-center space-y-4 max-w-xl mx-auto">
      <h1 className="text-2xl font-bold">Something went wrong</h1>
      <p className="text-muted text-sm">
        We couldn&apos;t load this page. It may be temporary.
      </p>
      <button type="button" onClick={() => retry()} className="btn-primary text-sm">
        Try again
      </button>
    </div>
  );
}
```

Use `retry` (stable in v16.3) — **not** `reset`, which only clears the error state without re-fetching.

### 3b. `src/app/global-error.tsx`

Must render its own `<html>`/`<body>`; it does **not** inherit the root layout's global styles, so import `./globals.css` inside it as well and keep markup minimal, otherwise `.card` / `.btn-primary` render unstyled.

### 3c. Detail-segment boundary — `src/app/events/[id]/error.tsx`

Add an `error.tsx` for that segment so a roster/comment read failure degrades the segment instead of 500-ing the route. Trade-off to state honestly: a segment `error.tsx` replaces the **whole** segment, not just the failed section. True per-section isolation needs a client error boundary per section (the class pattern in the docs, or the `catchError` API referenced at `error.md:94`) — optional follow-up, not part of this fix.

### 3d. Server-side error logging — `src/instrumentation.ts`

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

Without this there is nothing to correlate `error.digest` against in production.

### 3e. Verification

Temporarily point the dev-branch `DATABASE_URL` at a bad host, load `/events` → the boundary must render rather than a raw 500; restore the URL and confirm "Try again" recovers.

---

## Phase 4 — H1: timezone correctness

### Problem recap

Timezone is never considered. `new Date('2026-10-20T18:00')` (from `<input type="datetime-local">`) is parsed in the **server's** local zone (`event-validation.ts:52–56`); `formatEventDate` (`events.ts:485–494`) and `toDatetimeLocalValue` render with no `timeZone`; `startOfDay` / `whenDateRange` (`:75–89`) and `startsInLabel` (`:295–309`) anchor "Today/This week" to server-local midnight.

On a UTC host an organizer in UTC+3 creating an 18:00 event stores 18:00 UTC — three hours off — and the browse filters compute wrong day boundaries for most users. It looks self-consistent in local dev (server TZ == user TZ), so it only surfaces in production.

### Decision required

- **A — store the author's zone (recommended).** Add `Event.timeZone`, capture the browser's IANA zone at create/edit, render every time in that zone. Deterministic, correct for a distributed audience, works in notifications and ICS, no client JS needed for display.
- **B — one app-wide zone.** No schema change (an env var only), but every event authored in another zone displays wrong. Cheapest, least correct.
- **C — render in each viewer's browser zone.** Correct per viewer, but needs client components at every display site, reintroduces the hydration dance the codebase deliberately avoids, and cannot be used in stored notification bodies.

### 4a. Schema

```prisma
model Event {
  /// IANA zone the organizer authored `date` in (e.g. "Europe/Berlin").
  /// Null for rows created before this fix -> render with APP_TIME_ZONE.
  timeZone String?
}
```

`npx prisma migrate dev --name add_event_time_zone` (uses `DATABASE_URL_UNPOOLED`). Existing rows stay `null` → fall back to `APP_TIME_ZONE` (default `'UTC'`). No backfill.

### 4b. New `src/lib/time.ts`

`DEFAULT_TIME_ZONE`, `isValidTimeZone` (try/catch around `new Intl.DateTimeFormat`), `formatEventDate(date, timeZone)`, `toDatetimeLocalValue(date, timeZone)` via `Intl.DateTimeFormat(..., { timeZone }).formatToParts()`, and a `startOfDayIn(date, timeZone)` helper (offset search with `formatToParts`; accept a ±1 h DST edge and document it).

### 4c. Capture the instant correctly on submit

Both forms are already client components. In `events/new/page.tsx` and `EditEventForm.tsx`:

```tsx
const [dateValue, setDateValue] = useState(initial?.dateValue ?? '');
const [timeZone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone);

<input type="hidden" name="dateUtc" value={dateValue ? new Date(dateValue).toISOString() : ''} />
<input type="hidden" name="timeZone" value={timeZone} />
```

`new Date('2026-10-20T18:00')` in the browser resolves in the **browser's** zone, so `toISOString()` is the unambiguous instant. In `parseEventForm` (`event-validation.ts:52`):

```ts
const dateUtcRaw = (formData.get('dateUtc') as string | null) ?? '';
const date = dateUtcRaw ? new Date(dateUtcRaw) : new Date(dateRaw); // raw = no-JS fallback
const timeZoneRaw = (formData.get('timeZone') as string | null) ?? '';
const timeZone = isValidTimeZone(timeZoneRaw) ? timeZoneRaw : null;
```

Keep the no-JS fallback but document that it assumes the server zone.

### 4d. Thread the zone through every display site

Display sites to update (all currently use server-local formatting):

`events/actions.ts:104,312` · `edit/actions.ts:69,138` · `events/[id]/page.tsx:55,350` · `components/EventCard.tsx:60` · `components/OrganizerEventCard.tsx:50` · `notifications/page.tsx:91` · `wishlist/page.tsx:69,96` · `invite/[token]/page.tsx:55,70` · `notifications/UpcomingWidget.tsx:38` · `edit/page.tsx:35` (`toDatetimeLocalValue` must format in the event's zone so edits round-trip).

Because `getOrganizerEvents` / `getUpcomingRsvps` / `getEventById` return full `Event` rows, `timeZone` flows through automatically.

Also fix the day boundaries: `lib/events.ts:75–89` and `:295–309` must compute in an explicit zone instead of `new Date(y, m, d)`. Document that browse "Today/This week" are anchored to `APP_TIME_ZONE`. Related minor finding (B12): the labels say "This week"/"This month" but the math means "next 7/30 days" — fix the label or the math while here.

### 4e. Verification

`tsx` assertion on `formatEventDate(new Date('2026-10-20T18:00:00Z'), 'America/New_York')`; then set the browser to a different zone (or override `APP_TIME_ZONE`), create an event, and confirm the detail page and the edit form show the same wall clock the organizer typed.

**Rollback:** additive column; revert code and drop the column (no data loss — stored instants are unaffected).

---

## Phase 5 — H4: rate limiting

### Problem recap

No rate limiting or abuse control on mutating actions. One authenticated user can toggle RSVP indefinitely, and each `addComment` fans out up to `NOTIFY_RECIPIENT_CAP = 20` notifications (`comments/actions.ts:59–81`); each RSVP change can fan out promotions plus an organizer "left" notice. This is notification-spam / write-amplification on a per-user-free basis.

No Redis in this stack, so use Postgres (Neon) as the counter store.

### 5a. Model

```prisma
model RateLimit {
  key         String   @id
  count       Int      @default(0)
  windowStart DateTime @default(now())
}
```

### 5b. `src/lib/rate-limit.ts` — one atomic statement, no read-then-write race

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

### 5c. Application points

Apply after the auth guard, returning the existing `{ ok: false, error }` shape so no UI changes are needed:

| Action | Key | Suggested limit |
|---|---|---|
| `addComment` (`comments/actions.ts:32`) | `comment:{userId}` | 5 / 60 s |
| `setRsvp` / `joinWishlist` / `cancelRsvp` (`events/actions.ts:210, 226, 243`) | `rsvp:{userId}` | 30 / 60 s |
| `createInviteLink` / `regenerateInviteLink` (`events/actions.ts:369, 389`) | `invite:{userId}` | 10 / 60 s |
| `acceptInvite` (`events/actions.ts:427`) | `accept:{userId}` | 10 / 60 s |

`addComment`'s 20-recipient fan-out is the amplification path, so it gets the tightest limit. Add opportunistic cleanup of stale `RateLimit` rows (delete-where older than a day) or a Neon scheduled job — function triggers/cron are covered by the neon skill if you want it out of the request path.

### 5d. Verification

`tsx` script calling `consume` 60× and asserting the 6th fails at a limit of 5; manual: click "Post comment" rapidly and confirm the inline error surfaces instead of a silent fan-out.

---

## Definition of done

1. `npx tsx scripts/rsvp-concurrency.ts` passes, and the pre-fix `OVERBOOKED` output is saved as evidence.
2. `npx tsc --noEmit` clean; `npx eslint src/app src/components src/lib src/db.ts src/proxy.ts` clean; `npm run build` succeeds.
3. Manual pass: session-expiry redirect shows no spurious error; a DB outage shows the error boundary with "Try again"; a past-date RSVP is rejected; an event created in a non-server timezone displays the wall clock the organizer typed; rapid clicking yields the rate-limit message instead of a silent write storm.
4. Two migrations (`add_event_time_zone`, `add_rate_limit`) applied and reviewed on the dev branch before touching the primary branch.

## Open decisions

1. **Timezone model — A, B, or C?** Recommendation: **A** (`Event.timeZone` + browser-captured zone), at the cost of a schema change and ~14 display sites. B is cheaper but wrong for distributed users.
2. **Scope per PR.** Total ~12 h. Suggested: Phase 1 + 2 in one PR (correctness + UX), Phase 3 separately (small), then Phase 4 and 5.

## Related non-blocking findings

Out of scope for this plan but worth ticket-ing: N+1 in `getUserWishlist` (`lib/events.ts:405–421`), redundant per-request reads on the event detail page (3× `getEventById`, 2× `getRsvpCounts` → wrap in React `cache()`), `InviteLinkManager` hydration mismatch (`:22–26`), notification unread-count mismatch (`notifications/page.tsx:32` vs `lib/notifications.ts:16–21`), unauthorized-by-omission data accessors (`getAttendees`/`getWishlist`/`getComments`), missing security headers, and `src/generated` missing from `eslint.config.mjs` `globalIgnores`.
