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
