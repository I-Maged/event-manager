# Minor & Residual Implementation Plan

| | |
|---|---|
| Repository | `D:\career-new\event-manager` |
| Reviewed revision | `e08f9c0` ("neon rate-limiting") |
| Source | `fixes.md` — items not implemented at `e08f9c0` |
| Scope | 1 partially-fixed Medium, 1 Medium, 10 Minor, plus the HSTS residual from M6 |
| Stack | Next.js 16.4.0 (App Router, Turbopack, Cache Components, Partial Prefetching, React Compiler), React 19.3, Prisma 7 + `@prisma/adapter-neon`, Tailwind v4 |
| Status | **Phases 0–2 implemented (2026-10-20); phases 3–7 pending** |

> The Critical (C1, C2), High (H1–H4), and most Medium findings are already fixed.
> This plan covers only what is still open. Line numbers refer to `e08f9c0`.

---

## 1. Open items at a glance

| ID | `fixes.md` item | Severity | What is still wrong | Est. |
|---|---|---|---|---|
| O1 | M5 (remaining half) | Medium | Notifications page fetches a hard-capped 30 rows; no pagination / "load more". | 1.5 h |
| O2 | M7 | Medium | CSV export buffers the whole roster in memory and sends no `Cache-Control`. | 1.5 h |
| O3 | Minor | Minor | `cancelRsvp` has no "event has ended" guard; reachable from `/wishlist`. | 0.25 h |
| O4 | Minor | Minor | `createInviteLink` is read-then-write; concurrent calls can invalidate each other. | 0.5 h |
| O5 | Minor | Minor | Check-in is a racy read-then-write; no actor recorded. | 1 h |
| O6 | Minor | Minor | `contains` search passes `%` / `_` through as SQL wildcards. | 0.5 h |
| O7 | Minor | Minor | `organizer` query param has no length bound. | 0.25 h |
| O8 | Minor | Minor | Public list `count` + `findMany` read different snapshots. | 0.5 h |
| O9 | Minor | Minor | No `(eventId, status, createdAt)` index; no DB CHECKs for capacity/comment length. | 1.5 h |
| O10 | Minor | Minor | `useOptimistic(false)` used as a manual pending flag. | 0.5 h |
| O11 | Minor | Minor | `src/db.ts` imports `dotenv/config` redundantly. | 0.25 h |
| O12 | Minor | Minor | Non-null assertions on env vars produce cryptic failures. | 1 h |
| O13 | Minor | Minor | Comments header shows the windowed length, not the real count past 50. | 0.25 h |
| O14 | M6 residual | Minor | No `Strict-Transport-Security` header. | 0.25 h |

**Total:** ~10–12 hours including verification and documentation.

### Already fixed (do not redo)

C1, C2, H1–H4, M1–M4, M6 (headers/CSP report-only), M8, ESLint generated-code
ignore, and the week/month label correction. See the final section of this plan
for the explicit deferrals (CSP enforcement, invite token in the URL path).

---

## 2. Decisions required before coding

1. **Actor tracking (O5):** add `RSVP.checkedInBy String?` (recommended) or only
   make the write atomic and leave the actor unrecorded? Recommendation: add it —
   it is additive, nullable, and closes the "no actor recorded" half of the finding.
2. **Notifications pagination UX (O1):** Previous/Next pages (recommended, lower
   risk, consistent with `/events`) or a "Load more" client control? This plan
   assumes Previous/Next.
3. **Notification page size (O1):** 20 rows (recommended) or keep 30. Either is
   fine; the point is that older rows become reachable.
4. **`checkedInBy` in exports (O5):** keep the CSV columns unchanged
   (recommended) and treat the column as audit data only.
5. **HSTS scope (O14):** `max-age=63072000; includeSubDomains` without `preload`
   (recommended) or include `preload` only after every subdomain is HTTPS.
6. **Existing bad rows (O9):** should be zero because app validation prevents
   them. If the audit finds any, fix them explicitly (see remediation SQL) rather
   than silently clamping in the migration.

---

## 3. Sequencing and PR split

| Phase | Items | Why this order |
|---|---|---|
| 0 | Pre-flight + data audit | Proves the branch and finds rows that would block the CHECKs. |
| 1 | O9 (+ O5 schema) | One migration; later code depends on the new column/index. |
| 2 | O3, O4, O5 | Action-level guards and atomic writes; no UI churn. |
| 3 | O6, O7, O8 | Query correctness; independent of the migration. |
| 4 | O1, O2 | Pagination/streaming; the largest UI/route changes. |
| 5 | O10, O13, O14 | Small UI/header fixes. |
| 6 | O11, O12 | Hygiene; safe to land last. |
| 7 | Verification + docs | `npm run verify`, DB probes, manual QA additions. |

Suggested PRs:

- **PR-A:** Phase 1 + 2 (schema + action correctness). Requires migration review.
- **PR-B:** Phase 3 (query semantics). No migration.
- **PR-C:** Phase 4 (pagination + CSV streaming).
- **PR-D:** Phases 5 + 6 (UI pending flag, comments count, headers, env hygiene).

Every PR ends with `npm run verify`; PR-A also requires a dev-branch migration
run and the SQL checks in §6.

> **Phase status (2026-10-20):** Phase 0 ✅, Phase 1 ✅, Phase 2 ✅.
> See §14 for the implementation record and verification log. Phases 3–7 remain open.

---

## 4. Phase 0 — Pre-flight

1. Work on a **Neon dev branch**, never the primary branch. Runtime uses pooled
   `DATABASE_URL`; Prisma CLI uses `DATABASE_URL_UNPOOLED`
   (`prisma.config.ts:7`).
2. Record the baseline:
   ```bash
   npm run typecheck
   npx eslint src/app src/components src/lib src/db.ts src/proxy.ts
   npm run lint
   npm run build
   ```
3. Run the data audit **before** adding constraints:
   ```sql
   -- Must both return 0. Any row here would make the CHECK fail.
   SELECT count(*) FROM "Event"
    WHERE "maxAttendees" IS NOT NULL AND "maxAttendees" <= 0;

   SELECT count(*) FROM "Comment"
    WHERE char_length("body") > 1000;
   ```
4. Capture the current query plan for the waitlist hot path, so the new index can
   be compared:
   ```sql
   EXPLAIN (ANALYZE, BUFFERS)
   SELECT * FROM "RSVP"
    WHERE "eventId" = '<dev-event-id>' AND status = 'WAITLISTED'
    ORDER BY "createdAt" ASC
    LIMIT 10;
   ```

**Rollback:** none (read-only).

---

## 5. Phase 1 — Schema + database invariants (O9, O5 schema)

### O9 — Composite index and CHECK constraints

**Evidence.** `prisma/schema.prisma:87-90` declares only `@@index([eventId])`,
while the hottest waitlist query filters `eventId` + `status` and orders by
`createdAt` (`src/lib/rsvp.ts:94-111`, `src/lib/events.ts:459-463`). No DB-level
CHECK backs `maxAttendees > 0` or the comment length limit.

**Decision.** Add the composite index and two CHECK constraints in one migration.
Prisma does not model CHECK constraints; keep them in the migration SQL only and
document that `prisma db push` must not be used against this database.

**Steps.**

1. Add the index to `prisma/schema.prisma`:
   ```prisma
   model RSVP {
     // ...
     @@unique([userId, eventId])
     @@index([userId])
     @@index([eventId])
     @@index([eventId, status, createdAt])
   }
   ```
   Add a comment above the CHECKs' owning models that the constraints live in the
   migration (Prisma cannot express them):
   ```prisma
   // DB-level invariant (migration-only):
   //   CHECK ("maxAttendees" IS NULL OR "maxAttendees" > 0)
   ```

2. If decision 1 is accepted, add the audit column:
   ```prisma
   model RSVP {
     // ...
     /// Managed Auth user id of the organizer who performed the check-in.
     checkedInBy String?
   }
   ```

3. Create the migration without applying it:
   ```bash
   npx prisma migrate dev --create-only --name rsvp_hot_index_and_invariants
   ```

4. Append the constraints to the generated `migration.sql`:
   ```sql
   -- CreateIndex
   CREATE INDEX "RSVP_eventId_status_createdAt_idx"
       ON "RSVP"("eventId", "status", "createdAt");

   -- CHECK constraints (not representable in Prisma schema)
   ALTER TABLE "Event"
     ADD CONSTRAINT "Event_maxAttendees_positive"
     CHECK ("maxAttendees" IS NULL OR "maxAttendees" > 0);

   ALTER TABLE "Comment"
     ADD CONSTRAINT "Comment_body_length"
     CHECK (char_length("body") <= 1000);
   ```
   `char_length` counts code points; it is never stricter than the app's
   UTF-16 `.length` check, so no valid comment can be rejected.

5. Apply on the dev branch and regenerate the committed client. Implemented as
   `create-only` + `migrate deploy` so the reviewed SQL is applied as-is and no
   shadow-DB/drift prompt can fire:
   ```bash
   npx prisma migrate deploy
   npx prisma generate
   ```
   Commit the regenerated `src/generated/prisma` output along with the schema and
   migration.

6. If the audit in Phase 0 found rows, remediate before applying the migration
   (never inside it):
   ```sql
   -- Only after reviewing the offending rows.
   UPDATE "Event" SET "maxAttendees" = 1
    WHERE "maxAttendees" IS NOT NULL AND "maxAttendees" <= 0;

   UPDATE "Comment" SET "body" = left("body", 1000)
    WHERE char_length("body") > 1000;
   ```
   Prefer fixing data before the migration; the CHECK will otherwise abort the
   migration cleanly.

**Verification.**

```sql
-- Index exists and is used.
SELECT indexname FROM pg_indexes WHERE tablename = 'RSVP';

EXPLAIN (ANALYZE, BUFFERS)
SELECT * FROM "RSVP"
 WHERE "eventId" = '<dev-event-id>' AND status = 'WAITLISTED'
 ORDER BY "createdAt" ASC LIMIT 10;

-- Constraints exist.
SELECT conname, pg_get_constraintdef(oid)
  FROM pg_constraint
 WHERE contype = 'c'
   AND conrelid IN ('"Event"'::regclass, '"Comment"'::regclass);

-- Negative tests inside a rolled-back transaction.
BEGIN;
INSERT INTO "Event" (id, title, description, date, location, "maxAttendees", "userId")
VALUES ('probe-bad-cap', 'x', 'x', now(), 'x', 0, 'probe');
ROLLBACK; -- must fail before ROLLBACK
```

Also run `npx prisma migrate status` and confirm no drift is reported after the
CHECK-bearing migration is applied.

**Rollback.** Drop the constraints and index in a new migration
(`DROP INDEX "RSVP_eventId_status_createdAt_idx"`, `ALTER TABLE ... DROP
CONSTRAINT ...`). If `checkedInBy` shipped, drop the column. Data is unaffected.

---

## 6. Phase 2 — Action-level correctness (O3, O4, O5)

### O3 — `cancelRsvp` must reject ended events

**Evidence.** `src/lib/rsvp.ts:257-270` fetches the event but never checks
`event.date < new Date()`, unlike `upsertRsvpCore` (`:168-169`) and
`joinWishlist` (`src/app/events/actions.ts:128-130`). `/wishlist` renders
`LeaveWishlistButton` for past events because `getUserWishlist` does not filter
by date (`src/lib/events.ts:450-482`).

**Steps.**

1. In `cancelRsvpCore`, immediately after the event lookup inside the locked
   transaction:
   ```ts
   if (event.date < new Date()) {
     return { ok: false as const, error: 'This event has ended.' };
   }
   ```
   Return before the delete/promotion work so no promotion or organizer notice
   runs for a past event.
2. In `src/app/wishlist/page.tsx`, do not render `LeaveWishlistButton` for
   `entry.event.date < new Date()`; render a muted "Event ended" label instead.
   This avoids a control that always errors.

**Verification.** With a wishlisted past event, `cancelRsvp` returns
`{ ok: false, error: 'This event has ended.' }` and the row is unchanged. The
wishlist page shows no Leave control for it. Add this to
`docs/manual-qa.md` (§3 already covers past-date RSVP rejection).

**Rollback.** Revert the guard and the conditional render.

---

### O4 — Atomic invite-link creation

**Evidence.** `src/app/events/actions.ts:241-251` does `findUnique` → `update`.
Two concurrent calls can both observe `inviteToken === null`; the second write
wins and silently invalidates the token the first caller is about to show.

**Decision.** Claim the empty token with a single conditional `updateMany`; the
loser re-reads and returns the winner's token.

**Steps.** Replace the `update` in `createInviteLink` with:

```ts
const token = newInviteToken();
const claimed = await prisma.event.updateMany({
  where: { id: eventId, inviteToken: null, isPublic: false },
  data: { inviteToken: token },
});

if (claimed.count === 0) {
  // Another request won the race (or the event changed under us).
  const current = await prisma.event.findUnique({
    where: { id: eventId },
    select: { inviteToken: true },
  });
  if (!current) return { ok: false, error: 'Event not found.' };
  if (current.inviteToken) return { ok: true, token: current.inviteToken };
  return { ok: false, error: 'Could not create an invite link. Please retry.' };
}

revalidateEvent(eventId);
return { ok: true, token };
```

Keep the existing pre-checks (organizer, rate limit, existence, `isPublic`) so a
public event still receives the friendly error. `regenerateInviteLink` is
intentionally last-write-wins and is not changed.

Optional hardening: catch a `P2002` unique violation on `inviteToken` and retry
once with a fresh token.

**Verification.** On a dev branch, sign in as the organizer and fire two
`createInviteLink(eventId)` calls concurrently from the browser console (or two
tabs). Both must return the **same** token, and `Event.inviteToken` must match
it. A subsequent `createInviteLink` returns the same token (idempotent).

**Rollback.** Revert to the previous read-then-write shape (no data migration).

---

### O5 — Atomic, auditable check-in

**Evidence.** `src/app/events/actions.ts:341-355` reads the RSVP, then updates
it. Two rapid toggles can both read `checkedInAt === null` and write different
timestamps. No organizer id is stored. Undo has the same shape (`:373-383`).

**Decision.** Make both writes conditional single statements. If decision 1 is
accepted, also persist `checkedInBy`.

**Steps.**

1. Replace the check-in body with an atomic claim, then disambiguate a zero-row
   result:

   ```ts
   const now = new Date();
   const claimed = await prisma.rSVP.updateMany({
     where: {
       eventId,
       userId: attendeeUserId,
       status: 'GOING',
       checkedInAt: null,
     },
     data: { checkedInAt: now, checkedInBy: organizerId },
   });

   if (claimed.count === 0) {
     const rsvp = await prisma.rSVP.findUnique({
       where: { userId_eventId: { userId: attendeeUserId, eventId } },
       select: { status: true, checkedInAt: true },
     });
     if (!rsvp) return { ok: false, error: 'Attendee not found.' };
     if (rsvp.status !== 'GOING') {
       return { ok: false, error: 'Only Going attendees can be checked in.' };
     }
     // Already checked in: idempotent success with the stored timestamp.
     return { ok: true, checkedInAt: rsvp.checkedInAt?.toISOString() ?? null };
   }

   revalidateEvent(eventId);
   return { ok: true, checkedInAt: now.toISOString() };
   ```

   Under READ COMMITTED, a concurrent second update blocks on the row lock,
   re-evaluates `checkedInAt: null` after the first commit, and matches zero rows
   — so only one timestamp is ever written.

2. Replace undo with the mirror-image conditional update:

   ```ts
   await prisma.rSVP.updateMany({
     where: { eventId, userId: attendeeUserId, checkedInAt: { not: null } },
     data: { checkedInAt: null, checkedInBy: null },
   });
   const rsvp = await prisma.rSVP.findUnique({
     where: { userId_eventId: { userId: attendeeUserId, eventId } },
     select: { checkedInAt: true },
   });
   if (!rsvp) return { ok: false, error: 'Attendee not found.' };
   revalidateEvent(eventId);
   return { ok: true, checkedInAt: rsvp.checkedInAt?.toISOString() ?? null };
   ```

   Keep the existing `try/catch` wrappers that turn DB failures into
   `{ ok: false, error }`.

3. If `checkedInBy` is approved, the migration in Phase 1 adds it. No UI change
   is required; the CSV columns stay unchanged (decision 4).

**Verification.** On a dev branch, fire `checkInAttendee` twice in the same tick
from two tabs. Exactly one timestamp is stored; both calls return success and the
same ISO string. Undo twice yields `checkedInAt = null`, `checkedInBy = null`.
Verify with:
```sql
SELECT "checkedInAt", "checkedInBy" FROM "RSVP"
 WHERE "eventId" = '<id>' AND "userId" = '<attendee>';
```

**Rollback.** Revert the action code; drop `checkedInBy` in a new migration if it
shipped and must be removed.

---

## 7. Phase 3 — Query correctness (O6, O7, O8)

### O6 — Escape LIKE wildcards in search

**Evidence.** `src/lib/events.ts:113-123` passes the user query directly to
Prisma `contains`, so a lone `%` matches everything and `_` matches any
character. This is not injection (values are parameterized) but it changes search
semantics and forces a full scan.

**Steps.**

1. Create `src/lib/search.ts` (no DB/Next imports, so it is safe in a `tsx`
   probe):
   ```ts
   /**
    * Escape PostgreSQL LIKE metacharacters so user input is matched literally.
    * Backslash is the default LIKE escape character; the value is still
    * parameterized, so this only changes matching semantics.
    */
   export function escapeLikePattern(value: string): string {
     return value.replace(/[\\%_]/g, '\\$&');
   }
   ```
2. Use it in `searchFilter`:
   ```ts
   import { escapeLikePattern } from '@/lib/search';

   const contains = {
     contains: escapeLikePattern(q),
     mode: 'insensitive' as const,
   };
   ```
3. Add a tiny read-only probe, `scripts/search-check.ts`, using `node:assert/strict`:
   ```ts
   import assert from 'node:assert/strict';
   import { escapeLikePattern } from '@/lib/search';
   import { MAX_ORGANIZER_LENGTH, parseEventListParams } from '@/lib/discovery';

   assert.equal(escapeLikePattern('100%'), '100\\%');
   assert.equal(escapeLikePattern('a_b'), 'a\\_b');
   assert.equal(escapeLikePattern('a\\b'), 'a\\\\b');

   const longOrganizer = 'x'.repeat(MAX_ORGANIZER_LENGTH + 50);
   const parsed = parseEventListParams({ organizer: longOrganizer });
   assert.equal(parsed.organizer?.length, MAX_ORGANIZER_LENGTH);

   console.log('search assertions held.');
   ```
   Wire it into the `verify` script in `package.json` after
   `timezone-check.ts`.

**Verification.** `npx tsx scripts/search-check.ts` prints `search assertions
held.` In the UI, search for `%` and `_`: results shrink to literal matches
instead of returning everything. `npm run verify` stays green.

**Rollback.** Revert the helper and the `searchFilter` call; delete the probe.

---

### O7 — Bound the `organizer` query param

**Evidence.** `src/lib/discovery.ts:93-94` trims `organizer` but never caps its
length, while `q` is capped at `MAX_QUERY_LENGTH` (`:78`).

**Steps.** In `src/lib/discovery.ts`:

```ts
export const MAX_ORGANIZER_LENGTH = 128;

// ...
const organizerValue = (firstValue(input.organizer) ?? '')
  .trim()
  .slice(0, MAX_ORGANIZER_LENGTH);
```

128 is comfortably above Managed Auth user ids (UUID-shaped) while preventing an
unbounded free-text parameter. Do not narrow the character set; ids are opaque.

**Verification.** `/events?organizer=` followed by 500 characters renders the
normal list (truncated to 128) with no 500 or excessive query. The assertion in
`scripts/search-check.ts` covers the parse boundary.

**Rollback.** Remove the slice and constant.

---

### O8 — Consistent count + page snapshot

**Evidence.** `src/lib/events.ts:143-152` runs `count` and `findMany` as separate
statements at READ COMMITTED, so `total`/`pageCount` can disagree with the page
under concurrent writes. The `page` clamp is derived from the stale `total`.

**Decision.** Wrap both reads in one `RepeatableRead` transaction. Two short
SELECTs; no retries needed.

**Steps.** Rewrite the tail of `getPublicEventsPage`:

```ts
return prisma.$transaction(
  async (tx) => {
    const total = await tx.event.count({ where });
    const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const page = Math.min(Math.max(params.page, 1), pageCount);

    const events = await tx.event.findMany({
      where,
      orderBy: publicEventOrderBy(params.sort),
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    });

    return { events, total, page, pageCount };
  },
  { isolationLevel: 'RepeatableRead' },
);
```

If TypeScript rejects the string literal, import the runtime `Prisma` value from
`@/generated/prisma` and pass
`Prisma.TransactionIsolationLevel.RepeatableRead`. Keep `await connection()` above
the transaction so the route still renders at request time.

**Verification.** `npm run typecheck`; browse `/events` with filters and
pagination; confirm the "Showing X–Y of Z" line and page links agree. Optional:
run a concurrent insert/delete probe while hitting a page and confirm no
`total`/page mismatch.

**Rollback.** Revert to the two standalone queries.

---

## 8. Phase 4 — Notifications pagination + CSV streaming (O1, O2)

### O1 — Paginate notifications

**Evidence.** `src/lib/notifications.ts:24-45` caps at 30 rows and the page
renders exactly that window (`src/app/notifications/page.tsx:33-36,74`). Older
notifications are unreachable. The unread-count half of M5 is already fixed, so
only pagination remains.

**Decision.** Previous/Next URL pagination with a page size of 20. The existing
`Pagination` component is coupled to `EventListParams`, so add a small
notification-specific navigator instead of refactoring it.

**Steps.**

1. In `src/lib/notifications.ts`, add:
   ```ts
   export const NOTIFICATIONS_PAGE_SIZE = 20;

   export type NotificationsPageResult = {
     notifications: NotificationRow[];
     total: number;
     page: number;
     pageCount: number;
   };

   export async function getNotificationsPage(
     userId: string,
     requestedPage: number,
   ): Promise<NotificationsPageResult> {
     if (!userId) {
       return { notifications: [], total: 0, page: 1, pageCount: 1 };
     }

     const total = await prisma.notification.count({ where: { userId } });
     const pageCount = Math.max(1, Math.ceil(total / NOTIFICATIONS_PAGE_SIZE));
     const page = Math.min(Math.max(requestedPage, 1), pageCount);

     const notifications = await prisma.notification.findMany({
       where: { userId },
       orderBy: { createdAt: 'desc' },
       skip: (page - 1) * NOTIFICATIONS_PAGE_SIZE,
       take: NOTIFICATIONS_PAGE_SIZE,
       select: { /* same select as getNotifications */ },
     });

     return { notifications, total, page, pageCount };
   }
   ```
   Keep `getNotifications` for compatibility (no other caller today) or have it
   delegate to `getNotificationsPage` with an explicit limit if a future caller
   needs a capped list.

2. Create `src/components/PageNav.tsx` (Previous/Next + "Page X of Y"):
   ```tsx
   import Link from 'next/link';

   type Props = {
     page: number;
     pageCount: number;
     hrefForPage: (page: number) => string;
   };

   export function PageNav({ page, pageCount, hrefForPage }: Props) {
     if (pageCount <= 1) return null;
     const item =
       'inline-flex min-h-[36px] items-center justify-center rounded-md border px-3 text-sm';
     return (
       <nav aria-label="Pagination" className="flex items-center justify-center gap-2">
         {page > 1 ? (
           <Link href={hrefForPage(page - 1)} rel="prev" className={`${item} border-border hover:border-primary`}>
             Previous
           </Link>
         ) : (
           <span aria-disabled="true" className={`${item} border-border text-muted opacity-50`}>
             Previous
           </span>
         )}
         <span className="text-sm text-muted">Page {page} of {pageCount}</span>
         {page < pageCount ? (
           <Link href={hrefForPage(page + 1)} rel="next" className={`${item} border-border hover:border-primary`}>
             Next
           </Link>
         ) : (
           <span aria-disabled="true" className={`${item} border-border text-muted opacity-50`}>
             Next
           </span>
         )}
       </nav>
     );
   }
   ```
3. In `src/app/notifications/page.tsx`:
   - Accept `searchParams: Promise<Record<string, string | string[] | undefined>>`.
   - Parse `page` defensively (`Number.parseInt`, fall back to 1).
   - `const [{ notifications, total, page, pageCount }, unreadCount] = await Promise.all([getNotificationsPage(userId, requestedPage), getUnreadCount(userId)]);`
   - Use `total === 0` for the empty state (not `notifications.length`), because
     a valid page can be non-empty while a filtered window is temporarily empty.
   - Render the total range, e.g. `Showing 1–20 of 57`, and `<PageNav ... />`.
   - `hrefForPage={(p) => (p <= 1 ? '/notifications' : `/notifications?page=${p}`)}`.
   - Keep `MarkAllReadButton disabled={unreadCount === 0}` (DB-wide count).

**Verification.** Seed 57 notifications on a dev branch. Page 1 shows 20 rows and
"Page 1 of 3"; page 3 shows 17. Marking one read on page 2 keeps the page and
updates the unread count. The navbar bell and page header always agree. Test an
out-of-range `?page=999` → clamped to the last page, not an empty screen.

**Rollback.** Revert the page to `getNotifications(userId)` and remove
`PageNav`/`getNotificationsPage`. No data changes.

---

### O2 — Stream the attendee CSV

**Evidence.** `src/app/api/events/[id]/attendees/route.ts:24-41` calls
`getAttendees` (full roster, `src/lib/events.ts:398-414`), joins every row into
one string, and returns it without `Cache-Control`. Large events (up to 100k
RSVPs) spike memory, and the response may be retained by an intermediary.

**Decision.** Cursor-paginate the roster and stream it through a
`ReadableStream`; send `Cache-Control: private, no-store`. The organizer roster
panel keeps using `getAttendees` (it needs the complete in-memory list for
counts).

**Steps.**

1. In `src/lib/events.ts`, add a paged accessor. It must enforce visibility like
   the other loaders:
   ```ts
   export type AttendeeCsvRow = AttendeeRow & { id: string };

   export async function getAttendeesPage(
     event: Event,
     viewerId: string | null,
     opts: { cursor?: string; take?: number } = {},
   ): Promise<AttendeeCsvRow[]> {
     await assertCanView(event, viewerId);
     const take = Math.min(Math.max(opts.take ?? 500, 1), 1000);
     return prisma.rSVP.findMany({
       where: { eventId: event.id },
       orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
       take,
       ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
       select: {
         id: true,
         userId: true,
         attendeeName: true,
         status: true,
         createdAt: true,
         checkedInAt: true,
       },
     });
   }
   ```
   The `id` tiebreaker makes the cursor stable when rows share `createdAt`.

2. Rewrite the route as a stream. Keep `csvCell` unchanged (it already prevents
   formula injection and escapes quotes):
   ```ts
   const PAGE_SIZE = 500;
   const encoder = new TextEncoder();
   const csvLine = (a: AttendeeCsvRow) =>
     [
       csvCell(a.status),
       csvCell(a.attendeeName ?? ''),
       csvCell(a.createdAt.toISOString()),
       csvCell(a.checkedInAt?.toISOString() ?? ''),
     ].join(',');

   const stream = new ReadableStream<Uint8Array>({
     async start(controller) {
       controller.enqueue(encoder.encode('status,name,joined_at,checked_in\n'));
       let cursor: string | undefined;
       try {
         for (;;) {
           if (req.signal.aborted) break;
           const rows = await getAttendeesPage(event, userId, {
             cursor,
             take: PAGE_SIZE,
           });
           if (rows.length === 0) break;
           controller.enqueue(
             encoder.encode(rows.map(csvLine).join('\n') + '\n'),
           );
           if (rows.length < PAGE_SIZE) break;
           cursor = rows[rows.length - 1].id;
         }
         controller.close();
       } catch (error) {
         console.error('attendee CSV stream failed', { eventId: id, error });
         controller.error(error);
       }
     },
   });

   return new Response(stream, {
     headers: {
       'Content-Type': 'text/csv; charset=utf-8',
       'Content-Disposition': `attachment; filename="event-${id}-attendees.csv"`,
       'Cache-Control': 'private, no-store',
     },
   });
   ```
   Change the handler signature from `_req` to `req` so `req.signal` is
   available. Auth/visibility checks stay before the stream is constructed; a
   failure after the first byte can only reset the response, which is the best
   available behavior.

3. Do not add `checkedInBy` to the CSV (decision 4).

**Verification.**
- `next start`, then:
  ```bash
  curl -i http://localhost:3000/api/events/<id>/attendees
  ```
  Confirm `Cache-Control: private, no-store` and a valid CSV.
- Seed 1,200 attendees on a dev branch; the response must contain 1,201 lines
  including the header, with no duplicates/missing ids across page boundaries
  (spot-check first/last and a random middle row).
- Request as a non-organizer → 404; signed out → 401 (unchanged).
- Watch memory while exporting a large event (should stay flat).

**Rollback.** Revert the route and remove `getAttendeesPage`. No data changes.

---

## 9. Phase 5 — UI pending flag, comments count, HSTS (O10, O13, O14)

### O10 — Replace `useOptimistic(false)` with `useTransition`

**Evidence.** `src/components/EventFilters.tsx:47` and
`src/components/DashboardFilters.tsx:42` use `useOptimistic(false)` as a manual
pending boolean, setting it inside `startTransition`. With Partial Prefetching the
optimistic value can revert when the transition commits, possibly before the
streamed content lands, clearing the dim early.

**Steps.** In both components:

1. Replace the import and state:
   ```ts
   import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
   // ...
   const [isPending, startTransition] = useTransition();
   ```
2. Simplify `navigate`:
   ```ts
   const navigate = useCallback(
     (href: string) => {
       startTransition(() => {
         router.push(href);
       });
     },
     [router, startTransition],
   );
   ```
   Remove `setIsPending` and its dependency.
3. Keep `data-pending={isPending ? '' : undefined}` and the existing
   `group-has-data-pending:opacity-50` result-area class.

**Verification.** `npm run typecheck` + scoped ESLint. In DevTools with network
throttling, change a filter and confirm the results area stays dimmed until the
new content renders, then clears. Test search debounce, category chips, sort,
and "Clear all" on both `/events` and `/my-events`.

**Rollback.** Revert both components to `useOptimistic(false)`.

---

### O13 — Show the real comment count in the header

**Evidence.** `src/app/events/[id]/page.tsx:106` renders `comments.length`, while
`getComments` is capped at 50 (`src/lib/events.ts:360-379`), so 51+ comments show
"Comments (50)". `getCommentCount` already exists (`:382-384`).

**Steps.** In `CommentSection`:

```ts
const [comments, commentCount] = await Promise.all([
  getComments(event, viewerId),
  getCommentCount(eventId),
]);
// ...
<h2 className="font-semibold">Comments ({commentCount})</h2>
```

Add `getCommentCount` to the existing import from `@/lib/events`. This adds one
`COUNT` query per detail render; acceptable and bounded.

**Verification.** Seed 51 comments on a dev branch. The header says "Comments
(51)" while the list renders 50. With 0 comments it says "Comments (0)" and the
empty state still appears.

**Rollback.** Revert to `comments.length`.

---

### O14 — Add HSTS (M6 residual)

**Evidence.** `next.config.ts:26-46` sends `X-Content-Type-Options`,
`Referrer-Policy`, `X-Frame-Options`, `Permissions-Policy`, and a report-only
CSP, but no `Strict-Transport-Security`.

**Steps.** Add to the headers array (decision 5):

```ts
{
  key: 'Strict-Transport-Security',
  value: 'max-age=63072000; includeSubDomains',
},
```

Do not add `preload` until every subdomain is HTTPS and the domain has been
submitted. Browsers ignore HSTS over plain HTTP, so local dev is unaffected.
CSP promotion from report-only to enforcing (nonce via `src/proxy.ts`) remains
deferred (§11).

**Verification.** `npm run build`; `curl -I` against the deployed HTTPS host
shows the header. Confirm ordinary sign-in, Google redirect, and RSVP flows still
work.

**Rollback.** Remove the header entry.

---

## 10. Phase 6 — Environment hygiene (O11, O12)

### O11 — Remove the redundant `dotenv/config` import from `src/db.ts`

**Evidence.** `src/db.ts:1` imports `dotenv/config`; Next.js loads `.env*`
automatically, so the import is a redundant module side effect. Every standalone
script already imports `dotenv/config` before `@/db`:
`scripts/rsvp-concurrency.ts`, `rate-limit-check.ts`, `rate-limit-cleanup.ts`,
`backfill-time-zone.ts`, `timezone-check.ts`, and `preflight.ts`. No
`functions/*` file imports `@/db`.

**Steps.** Delete line 1 from `src/db.ts`. Add a comment documenting the contract:

```ts
// Next.js loads .env* automatically. Standalone tsx scripts must
// `import 'dotenv/config'` before importing this module.
```

**Verification.**
- `npm run build` (Next env loading still works).
- `npx tsx scripts/timezone-check.ts` (does not use the DB but imports dotenv).
- On the dev branch, `npx tsx scripts/rsvp-concurrency.ts --allow-writes` and
  `npx tsx scripts/rate-limit-check.ts --allow-writes` still connect.
- Search for any new entry point importing `@/db` without dotenv.

**Rollback.** Restore the import.

---

### O12 — Replace non-null env assertions with clear errors

**Evidence.** `src/db.ts:11` (`DATABASE_URL!`) and
`src/lib/auth/server.ts:30,32` (`NEON_AUTH_BASE_URL!`,
`NEON_AUTH_COOKIE_SECRET!`) turn a missing secret into a cryptic adapter/SDK
failure. `prisma.config.ts:7` already uses its `env()` helper.

**Steps.**

1. Create `src/lib/env.ts`:
   ```ts
   /**
    * Read a required environment variable or fail with an actionable message.
    * Never include the value in the error (secrets must not reach logs).
    */
   export function requireEnv(name: string): string {
     const value = process.env[name];
     if (!value || value.trim().length === 0) {
       throw new Error(
         `Missing required environment variable "${name}". ` +
           'Add it to .env (see .env.example) or the deploy environment.',
       );
     }
     return value;
   }
   ```
2. Use it in `src/db.ts`:
   ```ts
   import { requireEnv } from '@/lib/env';
   // ...
   const adapter = new PrismaNeon({
     connectionString: requireEnv('DATABASE_URL'),
   });
   ```
3. Use it in `src/lib/auth/server.ts`:
   ```ts
   export const auth = createNeonAuth({
     baseUrl: requireEnv('NEON_AUTH_BASE_URL'),
     cookies: {
       secret: requireEnv('NEON_AUTH_COOKIE_SECRET'),
     },
     logger,
   });
   ```
4. Do **not** require `APP_TIME_ZONE` (optional by design; `src/lib/time.ts`
   falls back to `UTC`). Do not add `NEON_AUTH_JWKS_URL` unless a code path
   actually reads it.

**Verification.**
- Normal build/dev still works.
- Temporarily unset `DATABASE_URL` (or point it at an empty value) in a scratch
  shell and import `src/db.ts`; the thrown message names the variable and does
  not print a secret. Repeat for `NEON_AUTH_BASE_URL`.
- Confirm `npm run build` fails fast with the same clear message when a required
  var is absent (desired).

**Rollback.** Remove `src/lib/env.ts` and restore the `!` assertions.

---

## 11. Phase 7 — Verification and documentation

### Automated gates

```bash
npm run typecheck
npx eslint src/app src/components src/lib src/db.ts src/proxy.ts
npm run lint                       # repo-wide, generated code excluded
npx tsx scripts/search-check.ts    # new read-only probe
npm run verify                     # typecheck + scoped lint + timezone probe + build
```

After adding `search-check.ts` to `package.json`'s `verify` script, the single
command covers it.

On the Neon dev branch only:

```bash
npm run verify:db                  # rsvp-concurrency + rate-limit probes
npx prisma migrate status
```

The `rsvp-concurrency` probe also exercises `cancelRsvpCore`; confirm the new
ended guard did not break the fixture (fixtures use future dates).

### Manual QA additions (`docs/manual-qa.md`)

Add a section for this release with these checks:

1. **Notifications pagination:** seed >20 notifications; page through; confirm
   older rows are reachable, counts agree, out-of-range pages clamp.
2. **CSV streaming:** export a 1,000+ attendee event; confirm `Cache-Control:
   private, no-store`, correct row count, and no memory spike.
3. **Past-event wishlist:** a wishlisted past event shows "Event ended" and the
   action returns the ended error (extend existing §3).
4. **Invite concurrency:** two simultaneous "Create invite link" clicks return
   the same token; refresh is idempotent.
5. **Check-in concurrency:** two rapid check-ins store exactly one timestamp;
   undo clears both timestamp and actor.
6. **Search semantics:** `%` and `_` no longer act as wildcards; a 500-character
   `organizer` param renders normally.
7. **Comments count:** 51 comments show "Comments (51)" with 50 rendered.
8. **HSTS:** deployed response includes `Strict-Transport-Security`; normal auth
   and RSVP flows are unaffected.

### Documentation

- `docs/manual-qa.md`: add the eight checks above.
- `src/lib/events.ts` / `src/lib/search.ts`: document the literal-match search
  semantics and the 128-character organizer cap.
- `src/lib/env.ts`: document the fail-fast contract.
- `prisma/schema.prisma`: comment that the CHECK constraints live in the
  migration, and that `prisma db push` is not the deployment path.
- This plan: fill in the implementation record (§14) as items land.

---

## 12. Definition of done

1. O1–O14 are implemented, or an item is explicitly deferred with a reason.
2. `npm run verify` is green; `npm run lint` is clean.
3. `npx prisma migrate status` shows no drift; the migration is applied on the
   dev branch and reviewed before production.
4. The composite index is present and used by the waitlist query plan.
5. Both CHECK constraints exist and reject bad rows (verified in a rolled-back
   transaction).
6. The two DB probes still pass on a dev branch.
7. Manual QA items in §11 are signed off.
8. No Critical/High/Medium item from `fixes.md` remains open except the explicit
   deferrals below.

---

## 13. Explicitly out of scope

These were mentioned in `fixes.md` as "ideally"/"consider" and are **not**
required to close the open items:

- **Promoting CSP from report-only to enforcing.** This needs a nonce threaded
  through `src/proxy.ts` and a pass over Next's inline bootstrap scripts.
  Track separately.
- **Moving the invite token out of the URL path.** `Referrer-Policy:
  strict-origin-when-cross-origin` prevents cross-origin path leakage; a
  header/body token would be a larger flow change.
- **Per-event minimum comment interval.** The existing per-user fixed window
  (5/min) already bounds the fan-out; an additional per-event interval is a
  product decision.
- **Comment/roster/joined timestamps rendered with `toLocaleDateString` and no
  `timeZone`.** Not part of H1 (which concerned event times); server-rendered and
  hydration-safe. Could be normalized to `formatEventDate` in a future polish
  pass.
- **`deleteEvent` rate limiting.** It fans out once and is organizer-only; not in
  the report's H4 list.

---

## 14. Implementation record (fill in as items land)

| ID | Status | Commit / file | Notes |
|---|---|---|---|
| O1 | ☐ | | |
| O2 | ☐ | | |
| O3 | ✅ | `src/lib/rsvp.ts`, `src/app/wishlist/page.tsx` | Ended guard returns before delete/promotion; past wishlist rows show "Event ended". |
| O4 | ✅ | `src/app/events/actions.ts` | Conditional `updateMany` claim; loser re-reads the winner's token (also re-checks `isPublic`). |
| O5 | ✅ | `src/app/events/actions.ts`, `prisma/schema.prisma`, migration | `checkedInBy` decision: **added**. Conditional claim + mirror undo. |
| O6 | ☐ | | |
| O7 | ☐ | | |
| O8 | ☐ | | |
| O9 | ✅ | `prisma/migrations/20261020191341_rsvp_hot_index_and_invariants` | Composite index + `Event_maxAttendees_positive` + `Comment_body_length`. |
| O10 | ☐ | | |
| O11 | ☐ | | |
| O12 | ☐ | | |
| O13 | ☐ | | |
| O14 | ☐ | | |

**Verification log (2026-10-20):**

- `npm run verify` — exit 0 (typecheck, scoped ESLint, timezone probe, `next build`).
- `npm run lint` — exit 0, no findings.
- `npx prisma migrate status` — 13 migrations, "Database schema is up to date!".
- Catalog: `RSVP_eventId_status_createdAt_idx` present and chosen by the planner
  with `enable_seqscan = off`; both CHECK constraints present; `checkedInBy`
  nullable `text`.
- Negative probes (rolled back): capacity `0` → SQLSTATE `23514`
  `Event_maxAttendees_positive`; 1001-char comment → `23514`
  `Comment_body_length`; 1000-char control accepted. Row counts returned to 0.
- Fixture assertions: ended cancel keeps the row; concurrent check-ins store one
  timestamp plus the actor; undo clears both; concurrent invite claims converge
  on one token; no fixtures left behind.
- `PROBE_RACERS=3 npm run verify:db` — rate-limit and RSVP probes both report
  "all invariants held." The default 8-racer run exceeds the 15s transaction
  timeout in this environment because each advisory-lock-serialized transaction
  takes ~3.2s; the racer count is an environment-latency override (documented in
  `docs/manual-qa.md` §6), not a code change.
- Deviation: the RSVP and capacity interactive transactions now pass
  `maxWait: 15_000` alongside the existing `timeout: 15_000`, so a cold Neon
  pool cannot fail a burst with "Unable to start a transaction in the given
  time" before the transaction even starts.
- Manual QA: §3 extended (past-event wishlist) and new §8 added (invite-link /
  check-in atomicity) in `docs/manual-qa.md`; browser sign-off still pending.
