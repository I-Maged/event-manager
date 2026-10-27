# Phase 2 — Component Tests Plan

Scope: Vitest component tests (jsdom + Testing Library) for the client components that exist in `src/components/`. Per testing_plan.md Phase 2, server actions, `next/navigation`, and browser APIs are mocked. Tests for the ~8 missing components (RosterCheckInButton, InviteLinkManager, CommentForm, DeleteEventButton, CommentDeleteButton, LeaveWishlistButton, DismissPromotionButton, AcceptInviteButton) are deferred — those components do not exist yet.

## Prerequisites (already in place)

- `vitest.config.mts` — `components` project (jsdom, `tests/components/**`, setup `tests/setup/components.ts`)
- `tests/setup/components.ts` — jest-dom matchers + `cleanup()` after each test
- `npm test` runs unit + component projects with no DB/network

## Mocking strategy (all component specs)

1. `vi.mock('@/app/events/actions')` — mock `setRsvp`, `joinWishlist`, `cancelRsvp`, `dismissPromotion`, `setNotifyOnUpdate`. Default impl returns `{ ok: true }`; tests override per case via `mockResolvedValue` / `mockRejectedValue`.
2. `vi.mock('next/navigation')` — mock `useRouter` returning `{ push: vi.fn(), refresh: vi.fn() }`. Assert `router.push` called with expected `eventListHref`/`dashboardHref`.
3. `vi.spyOn(window, 'confirm')` — stub to `true`/`false` for cancel flows (RsvpControls).
4. `vi.mock('@/lib/auth/client')` — mock `authClient.useSession` returning `{ data: { user }, isPending: false }` for NavbarAuthClient / SignOutButton.
5. Do not render Server Components; pass parsed params as props (components are URL-driven, not `useSearchParams`-based).

## Test files to create (in order)

### 1. `tests/components/use-action-feedback.test.tsx` — `src/lib/useActionFeedback.ts`
- sets/clears pending correctly
- clears stale errors before each attempt
- uses the provided fallback message
- returns the action result
- rethrows framework control flow (`isFrameworkControlFlow`)

### 2. `tests/components/error-fallback.test.tsx` — `src/components/ErrorFallback.tsx`
- calls `retry()` rather than `reset()` when "Try again" clicked
- renders the digest when present
- logs the render error once per error change (console.error spy)

### 3. `tests/components/calendar-links.test.tsx` — `src/components/CalendarLinks.tsx`
- renders ICS link (`/api/events/${id}/calendar`) and Google link
- both anchors present with expected hrefs

### 4. `tests/components/page-nav.test.tsx` — `src/components/PageNav.tsx`
- renders nothing when `pageCount <= 1`
- Previous/Next hrefs correct via `hrefForPage`
- boundary pages disabled/omitted (`aria-disabled="true"`)
- "Page N of M" renders

### 5. `tests/components/pagination.test.tsx` — `src/components/Pagination.tsx`
- renders nothing when `pageCount <= 1`
- Previous/Next hrefs via `eventListHref`
- page window includes first/last/current ±2 with gaps
- current page has `aria-current="page"`

### 6. `tests/components/event-filters.test.tsx` — `src/components/EventFilters.tsx`
- category click navigates to expected `eventListHref`
- active category toggles off (click again → category null)
- When select navigates with new value
- Sort select navigates with new value
- search debounced before navigation (fake timers, 300 ms)
- search resyncs when URL-provided `q` changes (params prop update)
- active chips render for q/category/when/sort/organizer
- removing a chip navigates to correct href
- Clear all resets to default URL
- `aria-pressed` reflects active category
- `data-pending` exposed during transition

### 7. `tests/components/dashboard-filters.test.tsx` — `src/components/DashboardFilters.tsx`
- view/search/sort behave same as EventFilters (tab click → `dashboardHref`)
- search debounced
- active chips / remove search
- clear to defaults

### 8. `tests/components/rsvp-controls.test.tsx` — `src/components/RsvpControls.tsx` (most complex)
- past event renders ended state (no buttons)
- current status reflected with `aria-pressed`
- GOING/MAYBE/NOT_GOING calls `setRsvp` with matching status
- full event with no RSVP shows wishlist CTA
- wishlist CTA calls `joinWishlist`
- full event with a status shows warning instead of CTA
- WAITLISTED shows queue position
- successful wishlist result shows position message
- promoted banner appears for promoted GOING row
- dismiss calls `dismissPromotion` and hides banner
- action `{ok:false}` shows alert (`role="alert"`)
- thrown action shows generic error
- pending state always clears after rejection (stuck-button regression)
- framework redirect digest rethrown, not shown as error
- notify checkbox updates optimistically and reverts on failure/throw
- cancel asks confirmation (`window.confirm`), does nothing on decline
- cancel clears local status/position/promotion on success
- pending labels render for each in-flight operation

### 9. `tests/components/navbar-auth-client.test.tsx` — `src/components/NavbarAuthClient.tsx`
- renders loading state (`isPending`)
- renders signed-out state (Sign in / Sign up links)
- renders signed-in state (email + SignOutButton)

### 10. `tests/components/sign-out-button.test.tsx` — `src/components/SignOutButton.tsx`
- calls `authClient.signOut()` via `run`
- on success pushes `/` and refreshes
- on error shows error message, no navigation
- disabled while pending

## Validation

- `npm test` — unit + component suites green, no DB/env/network
- `npm run lint` on new `tests/components/**` files
- `npm run typecheck` clean
- Confirm no spec imports a missing component or real server action

## Out of scope

- Components that don't exist: RosterCheckInButton, InviteLinkManager, CommentForm, DeleteEventButton, CommentDeleteButton, LeaveWishlistButton, DismissPromotionButton, AcceptInviteButton (deferred to when components are created)
- `navbarAuthClient` Google sign-in provider flow (E2E, Phase 5)
- DB-backed assertions (DB integration, Phase 3)
- HTTP route contracts (Phase 4)
