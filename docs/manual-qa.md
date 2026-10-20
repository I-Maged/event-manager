# Manual QA — RSVP / timezone / rate-limit release

Run this checklist once per release that touches `src/app/events`,
`src/lib/rsvp.ts`, `src/lib/time.ts`, `src/lib/rate-limit.ts`, or the error
boundaries. Paste the result into the PR.

## 1. Session-expiry redirect has no error banner

1. Sign in, open an event, then delete the session cookie in DevTools.
2. Click **Going**.

- [ ] The browser lands on `/auth/sign-in`.
- [ ] No "Something went wrong" banner appears before the redirect.

## 2. DB outage shows a recoverable error boundary

1. On a scratch/dev branch, point `DATABASE_URL` at a bad host.
2. Load `/events`.

- [ ] The error boundary renders (not a raw 500).
- [ ] No digest is printed when `NODE_ENV=production` without one being set.
3. Restore `DATABASE_URL`.

- [ ] **Try again** recovers the page.
- [ ] The server log has one `[request error]` line with the same digest.

## 3. Past-date RSVP is rejected

1. Create an event whose `date` is in the past (or edit one after it ends).
2. Open it while signed in and attempt an RSVP.

- [ ] The action returns "This event has ended." and no RSVP row is created.

## 4. Event wall clock is stable across create/edit

1. In a browser whose zone differs from the server, create an event at 18:00.
2. Confirm the detail page shows 18:00 with the author's zone abbreviation.
3. Edit the title only (do not touch the date) and save.

- [ ] The displayed time does not shift.
- [ ] Editing the date does shift the instant, not the typed wall clock.

4. Legacy check: set a row's `timeZone` to `NULL` in the dev DB, edit its title,
   save, and re-read the row.

- [ ] `timeZone` is still `NULL` (no silent stamping).

## 5. Rapid writes surface the rate-limit message

1. Post comments quickly until the 6th attempt within a minute.
2. Click RSVP buttons repeatedly past 30/minute.

- [ ] The inline error says "Too many requests — please wait a moment."
- [ ] No silent write storm: the notification count stops growing.

## 6. Probes (dev branch only)

```bash
npm run verify
npm run verify:db   # passes --allow-writes; confirm the printed host first
```

- [ ] `scripts/timezone-check.ts` prints "all assertions held."
- [ ] `scripts/rate-limit-check.ts` prints "all invariants held."
- [ ] `scripts/rsvp-concurrency.ts` prints "all invariants held."
- [ ] `npm run lint` is clean (generated Prisma client excluded).
