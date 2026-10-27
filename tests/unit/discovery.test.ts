import { describe, expect, it } from 'vitest';
import {
  categoryFilterHref,
  dashboardHref,
  dashboardSortLabel,
  dashboardViewLabel,
  DEFAULT_EVENT_LIST_PARAMS,
  eventListHref,
  hasDashboardQuery,
  hasNarrowingFilters,
  MAX_ORGANIZER_LENGTH,
  MAX_QUERY_LENGTH,
  parseDashboardParams,
  parseEventListParams,
  sortLabel,
  whenLabel,
  type EventListParams,
} from '@/lib/discovery';

/** Ported from `scripts/search-check.ts` plus the URL-state contract. */

function params(overrides: Partial<EventListParams> = {}): EventListParams {
  return { ...DEFAULT_EVENT_LIST_PARAMS, ...overrides };
}

describe('parseEventListParams', () => {
  it('returns defaults for empty input', () => {
    expect(parseEventListParams({})).toEqual(DEFAULT_EVENT_LIST_PARAMS);
    expect(parseEventListParams({ q: '   ' })).toEqual(DEFAULT_EVENT_LIST_PARAMS);
  });

  it('uses the first value of array params', () => {
    const parsed = parseEventListParams({ q: ['first', 'second'], page: ['2'] });
    expect(parsed.q).toBe('first');
    expect(parsed.page).toBe(2);
  });

  it('trims and truncates the query', () => {
    expect(parseEventListParams({ q: '  hello  ' }).q).toBe('hello');
    expect(parseEventListParams({ q: 'x'.repeat(MAX_QUERY_LENGTH + 50) }).q)
      .toHaveLength(MAX_QUERY_LENGTH);
  });

  it('validates category, when, and sort', () => {
    const parsed = parseEventListParams({
      category: 'MUSIC',
      when: 'week',
      sort: 'popular',
    });
    expect(parsed).toMatchObject({ category: 'MUSIC', when: 'week', sort: 'popular' });

    const invalid = parseEventListParams({
      category: 'NOPE',
      when: 'someday',
      sort: 'random',
    });
    expect(invalid).toMatchObject({
      category: null,
      when: DEFAULT_EVENT_LIST_PARAMS.when,
      sort: DEFAULT_EVENT_LIST_PARAMS.sort,
    });
  });

  it('trims, truncates, and nulls a blank organizer', () => {
    const longOrganizer = 'x'.repeat(MAX_ORGANIZER_LENGTH + 50);
    expect(parseEventListParams({ organizer: longOrganizer }).organizer)
      .toHaveLength(MAX_ORGANIZER_LENGTH);
    expect(parseEventListParams({ organizer: '   ' }).organizer).toBeNull();
    expect(parseEventListParams({ organizer: '  user-1  ' }).organizer).toBe(
      'user-1',
    );
  });

  it('parses pages defensively', () => {
    expect(parseEventListParams({ page: '3' }).page).toBe(3);
    expect(parseEventListParams({ page: '2.9' }).page).toBe(2);
    expect(parseEventListParams({ page: '0' }).page).toBe(1);
    expect(parseEventListParams({ page: '-4' }).page).toBe(1);
    expect(parseEventListParams({ page: 'abc' }).page).toBe(1);
    expect(parseEventListParams({ page: '' }).page).toBe(1);
  });
});

describe('eventListHref', () => {
  it('omits defaults', () => {
    expect(eventListHref(DEFAULT_EVENT_LIST_PARAMS)).toBe('/events');
  });

  it('includes non-default values in a stable order', () => {
    expect(
      eventListHref(
        params({
          q: 'jazz',
          category: 'MUSIC',
          when: 'week',
          sort: 'popular',
          organizer: 'user-1',
          page: 2,
        }),
      ),
    ).toBe(
      '/events?q=jazz&category=MUSIC&when=week&sort=popular&organizer=user-1&page=2',
    );
  });

  it('resets the page when a filter changes', () => {
    expect(eventListHref(params({ q: 'jazz', page: 3 }), { category: 'TECH' })).toBe(
      '/events?q=jazz&category=TECH',
    );
  });

  it('keeps filters when only the page changes', () => {
    expect(eventListHref(params({ q: 'jazz' }), { page: 2 })).toBe(
      '/events?q=jazz&page=2',
    );
  });
});

describe('filter helpers', () => {
  it('ignores sort when deciding whether results are narrowed', () => {
    expect(hasNarrowingFilters(params({ sort: 'newest' }))).toBe(false);
    expect(hasNarrowingFilters(params({ q: 'x' }))).toBe(true);
    expect(hasNarrowingFilters(params({ category: 'TECH' }))).toBe(true);
    expect(hasNarrowingFilters(params({ when: 'today' }))).toBe(true);
    expect(hasNarrowingFilters(params({ organizer: 'user-1' }))).toBe(true);
  });

  it('labels known values and falls back safely', () => {
    expect(whenLabel('today')).toBe('Today');
    expect(sortLabel('popular')).toBe('Most popular');
    expect(whenLabel('bogus' as never)).toBe('Any time');
    expect(sortLabel('bogus' as never)).toBe('Soonest');
  });

  it('builds a category link', () => {
    expect(categoryFilterHref('TECH')).toBe('/events?category=TECH');
  });
});

describe('dashboard URL state', () => {
  it('parses defaults and malformed values', () => {
    expect(parseDashboardParams({})).toEqual({
      view: 'upcoming',
      q: '',
      sort: 'date',
    });
    expect(
      parseDashboardParams({ view: 'past', sort: 'fill', q: ' gal ' }),
    ).toEqual({ view: 'past', q: 'gal', sort: 'fill' });
    expect(
      parseDashboardParams({ view: 'nope', sort: 'nope', q: ['a', 'b'] }),
    ).toEqual({ view: 'upcoming', q: 'a', sort: 'date' });
    expect(parseDashboardParams({ q: '  hi  ' }).q).toBe('hi');
    expect(
      parseDashboardParams({ q: 'x'.repeat(MAX_QUERY_LENGTH + 20) }).q,
    ).toHaveLength(MAX_QUERY_LENGTH);
  });

  it('builds hrefs that omit defaults and round-trip', () => {
    expect(
      dashboardHref({ view: 'upcoming', q: '', sort: 'date' }),
    ).toBe('/my-events');

    const href = dashboardHref(
      { view: 'past', q: '', sort: 'date' },
      { sort: 'fill', q: 'jazz' },
    );
    expect(href).toBe('/my-events?view=past&q=jazz&sort=fill');
    expect(parseDashboardParams(searchOf(href))).toEqual({
      view: 'past',
      q: 'jazz',
      sort: 'fill',
    });
  });

  it('detects an active query and labels values', () => {
    expect(hasDashboardQuery({ view: 'all', q: '', sort: 'date' })).toBe(false);
    expect(hasDashboardQuery({ view: 'all', q: 'x', sort: 'date' })).toBe(true);
    expect(dashboardViewLabel('past')).toBe('Past');
    expect(dashboardSortLabel('fill')).toBe('Fill %');
    expect(dashboardViewLabel('bogus' as never)).toBe('Upcoming');
    expect(dashboardSortLabel('bogus' as never)).toBe('Date');
  });
});

function searchOf(href: string): Record<string, string> {
  const query = href.split('?')[1] ?? '';
  return Object.fromEntries(new URLSearchParams(query));
}
