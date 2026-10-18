import type { EventCategory } from '@/generated/prisma';
import { isEventCategory } from '@/lib/categories';

/**
 * URL-driven state for the public browse page. Kept free of runtime Prisma
 * imports so both server components (page, EventCard, Pagination) and the
 * client filter bar can import these helpers.
 */

export type WhenFilter = 'any' | 'today' | 'week' | 'month';
export type SortOrder = 'date' | 'newest' | 'popular';

export type EventListParams = {
  q: string;
  category: EventCategory | null;
  when: WhenFilter;
  sort: SortOrder;
  organizer: string | null;
  page: number;
};

export const DEFAULT_WHEN: WhenFilter = 'any';
export const DEFAULT_SORT: SortOrder = 'date';

/** Longest accepted free-text query (matches the DB's practical limits). */
export const MAX_QUERY_LENGTH = 200;

export const DEFAULT_EVENT_LIST_PARAMS: EventListParams = {
  q: '',
  category: null,
  when: DEFAULT_WHEN,
  sort: DEFAULT_SORT,
  organizer: null,
  page: 1,
};

export const WHEN_OPTIONS: { value: WhenFilter; label: string }[] = [
  { value: 'any', label: 'Any time' },
  { value: 'today', label: 'Today' },
  { value: 'week', label: 'This week' },
  { value: 'month', label: 'This month' },
];

export const SORT_OPTIONS: { value: SortOrder; label: string }[] = [
  { value: 'date', label: 'Soonest' },
  { value: 'newest', label: 'Newest' },
  { value: 'popular', label: 'Most popular' },
];

/** The keys that narrow the result set (as opposed to changing its order). */
const FILTER_KEYS = ['q', 'category', 'when', 'sort', 'organizer'] as const;

/** Raw `searchParams` as provided by the App Router (values may be arrays). */
export type RawSearchParams = Record<string, string | string[] | undefined>;

const WHEN_VALUES = WHEN_OPTIONS.map((option) => option.value);
const SORT_VALUES = SORT_OPTIONS.map((option) => option.value);

function firstValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function isWhenFilter(value: string): value is WhenFilter {
  return (WHEN_VALUES as string[]).includes(value);
}

function isSortOrder(value: string): value is SortOrder {
  return (SORT_VALUES as string[]).includes(value);
}

/**
 * Normalize arbitrary `searchParams` into a fully-defaulted `EventListParams`.
 * Unknown or malformed values fall back to defaults rather than erroring, so a
 * hand-typed URL never breaks the page.
 */
export function parseEventListParams(input: RawSearchParams): EventListParams {
  const q = (firstValue(input.q) ?? '').trim().slice(0, MAX_QUERY_LENGTH);

  const categoryValue = firstValue(input.category);
  const category = isEventCategory(categoryValue) ? categoryValue : null;

  const whenValue = firstValue(input.when);
  const when: WhenFilter = whenValue && isWhenFilter(whenValue)
    ? whenValue
    : DEFAULT_WHEN;

  const sortValue = firstValue(input.sort);
  const sort: SortOrder = sortValue && isSortOrder(sortValue)
    ? sortValue
    : DEFAULT_SORT;

  const organizerValue = (firstValue(input.organizer) ?? '').trim();
  const organizer = organizerValue.length > 0 ? organizerValue : null;

  const pageRaw = firstValue(input.page);
  const pageNum = pageRaw ? Number.parseInt(pageRaw, 10) : Number.NaN;
  const page = Number.isFinite(pageNum) && pageNum >= 1 ? Math.floor(pageNum) : 1;

  return { q, category, when, sort, organizer, page };
}

/**
 * Build an `/events` href from the current params plus optional changes.
 *
 * Default values are omitted for clean, shareable URLs, and any change to a
 * filter key resets pagination to page 1 (so a narrowed result set never
 * strands the user on an out-of-range page).
 */
export function eventListHref(
  params: EventListParams,
  changes: Partial<EventListParams> = {},
): string {
  const next: EventListParams = { ...params, ...changes };
  const filterChanged = FILTER_KEYS.some((key) => key in changes);
  const page = filterChanged ? 1 : next.page;

  const search = new URLSearchParams();
  if (next.q) search.set('q', next.q);
  if (next.category) search.set('category', next.category);
  if (next.when !== DEFAULT_WHEN) search.set('when', next.when);
  if (next.sort !== DEFAULT_SORT) search.set('sort', next.sort);
  if (next.organizer) search.set('organizer', next.organizer);
  if (page > 1) search.set('page', String(page));

  const query = search.toString();
  return query ? `/events?${query}` : '/events';
}

/** Href for browsing a single category (used by event cards). */
export function categoryFilterHref(category: EventCategory): string {
  return eventListHref(DEFAULT_EVENT_LIST_PARAMS, { category });
}

/**
 * True when params actually narrow the result set. Sort only reorders, so it is
 * excluded — this distinguishes "no matches" from "none exist yet".
 */
export function hasNarrowingFilters(params: EventListParams): boolean {
  return (
    params.q.length > 0 ||
    params.category !== null ||
    params.when !== DEFAULT_WHEN ||
    params.organizer !== null
  );
}

/** Human-readable label for a `when` value. */
export function whenLabel(when: WhenFilter): string {
  return WHEN_OPTIONS.find((option) => option.value === when)?.label ?? 'Any time';
}

/** Human-readable label for a `sort` value. */
export function sortLabel(sort: SortOrder): string {
  return SORT_OPTIONS.find((option) => option.value === sort)?.label ?? 'Soonest';
}

/**
 * URL-driven state for the organizer dashboard (`/my-events`). Like
 * `EventListParams`, this stays free of runtime Prisma imports so the page and
 * its client filter bar can share it.
 */

export type DashboardView = 'upcoming' | 'past' | 'all';
export type DashboardSort = 'date' | 'fill' | 'newest';

export type DashboardParams = {
  view: DashboardView;
  q: string;
  sort: DashboardSort;
};

export const DEFAULT_DASHBOARD_VIEW: DashboardView = 'upcoming';
export const DEFAULT_DASHBOARD_SORT: DashboardSort = 'date';

export const DASHBOARD_VIEW_OPTIONS: { value: DashboardView; label: string }[] = [
  { value: 'upcoming', label: 'Upcoming' },
  { value: 'past', label: 'Past' },
  { value: 'all', label: 'All' },
];

export const DASHBOARD_SORT_OPTIONS: { value: DashboardSort; label: string }[] = [
  { value: 'date', label: 'Date' },
  { value: 'fill', label: 'Fill %' },
  { value: 'newest', label: 'Newest' },
];

export const DEFAULT_DASHBOARD_PARAMS: DashboardParams = {
  view: DEFAULT_DASHBOARD_VIEW,
  q: '',
  sort: DEFAULT_DASHBOARD_SORT,
};

const DASHBOARD_VIEW_VALUES = DASHBOARD_VIEW_OPTIONS.map((option) => option.value);
const DASHBOARD_SORT_VALUES = DASHBOARD_SORT_OPTIONS.map((option) => option.value);

function isDashboardView(value: string): value is DashboardView {
  return (DASHBOARD_VIEW_VALUES as string[]).includes(value);
}

function isDashboardSort(value: string): value is DashboardSort {
  return (DASHBOARD_SORT_VALUES as string[]).includes(value);
}

/**
 * Normalize arbitrary `searchParams` into a fully-defaulted `DashboardParams`.
 * Unknown values fall back to defaults so a hand-typed URL never breaks.
 */
export function parseDashboardParams(input: RawSearchParams): DashboardParams {
  const q = (firstValue(input.q) ?? '').trim().slice(0, MAX_QUERY_LENGTH);

  const viewValue = firstValue(input.view);
  const view: DashboardView =
    viewValue && isDashboardView(viewValue) ? viewValue : DEFAULT_DASHBOARD_VIEW;

  const sortValue = firstValue(input.sort);
  const sort: DashboardSort =
    sortValue && isDashboardSort(sortValue) ? sortValue : DEFAULT_DASHBOARD_SORT;

  return { view, q, sort };
}

/**
 * Build a `/my-events` href from the current params plus optional changes.
 * Defaults are omitted for clean, shareable URLs.
 */
export function dashboardHref(
  params: DashboardParams,
  changes: Partial<DashboardParams> = {},
): string {
  const next: DashboardParams = { ...params, ...changes };

  const search = new URLSearchParams();
  if (next.view !== DEFAULT_DASHBOARD_VIEW) search.set('view', next.view);
  if (next.q) search.set('q', next.q);
  if (next.sort !== DEFAULT_DASHBOARD_SORT) search.set('sort', next.sort);

  const query = search.toString();
  return query ? `/my-events?${query}` : '/my-events';
}

/**
 * True when the dashboard has an active free-text query. View only narrows to a
 * subset of the same events, so it alone doesn't count as a "no matches" state.
 */
export function hasDashboardQuery(params: DashboardParams): boolean {
  return params.q.length > 0;
}

/** Human-readable label for a `view` value. */
export function dashboardViewLabel(view: DashboardView): string {
  return (
    DASHBOARD_VIEW_OPTIONS.find((option) => option.value === view)?.label ??
    'Upcoming'
  );
}

/** Human-readable label for a dashboard `sort` value. */
export function dashboardSortLabel(sort: DashboardSort): string {
  return (
    DASHBOARD_SORT_OPTIONS.find((option) => option.value === sort)?.label ?? 'Date'
  );
}
