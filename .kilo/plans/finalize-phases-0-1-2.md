# Plan: Finalize Phases 0, 1, and 2

Goal: After the next implementation turn, Phases 0 (harness), 1 (unit), and 2 (component) of `testing_plan.md` are fully complete — every `[x]`-able checkbox is checked, every existing component has a test, and optional/CI-only items are explicitly marked out of scope.

## Current state

- **Phase 0** — Harness complete. Remaining unchecked items are CI/documentation-only (Node ICU version, branch deletion in CI cleanup) or optional dependencies not installed (fast-check, ical.js, csv-parse). `auth.setup.ts` is a Playwright/Phase 5 item.
- **Phase 1** — Unit complete. Remaining unchecked items are two optional property tests requiring `fast-check` (not installed).
- **Phase 2** — `RsvpControls` (21/21), `EventFilters`/`DashboardFilters` (minus `data-pending`), `Pagination` (4/4), and shared UI state (`useActionFeedback`, `ErrorFallback`, `NavbarAuthClient`, `SignOutButton`, `CalendarLinks`) are done. Tests still missing for 13 components that already exist in `src/app/` and `src/components/`:
  - `RosterCheckInButton` (src/app/events/[id]/RosterCheckInButton.tsx)
  - `InviteLinkManager` (src/app/events/[id]/InviteLinkManager.tsx)
  - `CommentForm` (src/app/events/[id]/comments/CommentForm.tsx)
  - `CommentDeleteButton` (src/app/events/[id]/comments/CommentDeleteButton.tsx)
  - `DeleteEventButton` (src/app/events/[id]/edit/DeleteEventButton.tsx)
  - `LeaveWishlistButton` + `DismissPromotionButton` (src/app/wishlist/WishlistButtons.tsx)
  - `AcceptInviteButton` (src/app/invite/[token]/AcceptInviteButton.tsx)
  - Sign-in page (src/app/auth/sign-in/page.tsx)
  - Sign-up page (src/app/auth/sign-up/page.tsx)
  - `GoogleSignInButton` (src/components/GoogleSignInButton.tsx)
  - `MarkReadButton` + `MarkAllReadButton` (src/app/notifications/NotificationButtons.tsx)

## Decisions

1. **Test location**: All component tests live in `tests/components/` under the existing vitest `components` project (jsdom + Testing Library), per user confirmation. App-level components are imported via `@/app/...` paths resolved by the tsconfig `@/*` → `./src/*` alias.
2. **Mocking**: `next/navigation` (`useRouter` via `vi.hoisted`), `next/link` (rendered as anchors), `@/lib/auth/client`, `@/app/events/actions` (and comments/edit/actions where applicable). Server actions, router, and browser APIs are mocked — no DB, network, or real router.
3. **`data-pending` (EventFilters/DashboardFilters)**: Left unchecked with a note — not assertable with a mocked sync `push` because `useTransition` flushes immediately. Covered by Playwright in Phase 5.
4. **Phase 0 Phase 1 leftovers**: Optional property tests and optional deps marked out of scope (`fast-check` not installed). CI/ICU and branch-deletion items are CI/docs concerns, not code.
5. **DismissPromotionButton**: Behavior already covered inline in `RsvpControls` 2.1; the standalone WishlistButtons variant still gets its own test.

## Task list

### Phase 0 finalization (no code, just checklist updates)
- [ ] Mark optional dependency items (fast-check, ical.js, csv-parse) as out of scope in testing_plan.md §0.1.
- [ ] Mark CI Node ICU version and branch-deletion-in-CI as CI/docs concerns in §0.1/§0.4.
- [ ] Mark `auth.setup.ts` as Phase 5 in §0.2.
- [ ] Mark optional property tests (time, search) as out of scope in §1.1/§1.4.

### Phase 1 finalization (no code)
- [ ] Confirm all Phase 1 unit checkboxes are checked (they are; optional property tests marked out of scope).

### Phase 2 — Component test files to create (in `tests/components/`)

#### 2.1 RsvpControls — already complete (21/21). No new file.

#### 2.2 `roster-check-in.test.tsx` — `src/app/events/[id]/RosterCheckInButton.tsx`
- initial checked/unchecked state renders
- checking calls `checkInAttendee` and updates optimistically
- `{ok:false}` reverts and shows alert
- thrown error reverts and shows alert
- pending disables control and shows "Saving…"
- undo calls `undoCheckIn`

#### 2.3 `invite-link-manager.test.tsx` — `src/app/events/[id]/InviteLinkManager.tsx`
- no token shows create button
- create calls action and shows relative link
- copy builds absolute URL and writes to clipboard
- clipboard failure shows manual-copy message
- regenerate asks for confirmation
- regenerate replaces displayed token
- revoke asks for confirmation
- revoke clears link and shows revoked message
- action errors show alert
- thrown errors show generic message
- pending disables all controls

#### 2.4 `comment-form.test.tsx` — `src/app/events/[id]/comments/CommentForm.tsx`
- rejects empty input
- enforces max length and clears on success
- shows action and thrown errors

#### 2.5 `comment-delete-button.test.tsx` — `src/app/events/[id]/comments/CommentDeleteButton.tsx`
- calls action and handles errors

#### 2.6 `delete-event-button.test.tsx` — `src/app/events/[id]/edit/DeleteEventButton.tsx`
- confirms before calling action

#### 2.7 `leave-wishlist-button.test.tsx` — `src/app/wishlist/WishlistButtons.tsx` (LeaveWishlistButton)
- confirms and handles errors

#### 2.8 `dismiss-promotion-button.test.tsx` — `src/app/wishlist/WishlistButtons.tsx` (DismissPromotionButton)
- hides itself on success

#### 2.9 `accept-invite-button.test.tsx` — `src/app/invite/[token]/AcceptInviteButton.tsx`
- calls action and handles success/error

#### 2.10 `sign-in.test.tsx` — `src/app/auth/sign-in/page.tsx`
- requires email and password
- shows provider error message
- disables submit while pending
- pushes `/` and refreshes on success

#### 2.11 `sign-up.test.tsx` — `src/app/auth/sign-up/page.tsx`
- validates required fields and minimum password length
- shows provider errors and succeeds

#### 2.12 `google-sign-in-button.test.tsx` — `src/components/GoogleSignInButton.tsx`
- has expected label and calls provider

#### 2.13 `notification-buttons.test.tsx` — `src/app/notifications/NotificationButtons.tsx`
- mark-read / mark-all-read buttons call actions and handle errors

#### 2.14 Update testing_plan.md checkboxes
- Check off all Phase 2 items implemented by the new test files
- Confirm Phase 2 delivery phase line as `[x]` with deferral note for non-existent items

## Validation

- `npm test` — 18+ test files green, exit code 0, no unhandled errors
- `npx tsc --noEmit` — clean
- `npx eslint tests/components/` — clean
- `testing_plan.md` — Phase 0, 1, 2 delivery phases marked `[x]`; remaining unchecked items are optional/CI-only with notes

## Open questions (none blocking)

None. Single components project confirmed by user. All 13 components exist and their server actions are available in `src/app/events/actions.ts`, `src/app/events/[id]/comments/actions.ts`, `src/app/events/[id]/edit/actions.ts`, and `@/lib/auth/client`.