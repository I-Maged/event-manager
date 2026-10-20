'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useTransition,
} from 'react';
import { useRouter } from 'next/navigation';
import type { EventCategory } from '@/generated/prisma';
import { categoryLabel, EVENT_CATEGORIES } from '@/lib/categories';
import {
  DEFAULT_EVENT_LIST_PARAMS,
  eventListHref,
  SORT_OPTIONS,
  sortLabel,
  WHEN_OPTIONS,
  whenLabel,
  type EventListParams,
  type WhenFilter,
} from '@/lib/discovery';

type Props = {
  params: EventListParams;
  categoryCounts: Record<EventCategory, number>;
  organizerName: string | null;
};

const SEARCH_DEBOUNCE_MS = 300;

const CHIP_BASE =
  'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs cursor-pointer transition-colors';
const CHIP_IDLE =
  'border-border text-muted hover:border-primary hover:text-primary';
const CHIP_ACTIVE = 'border-primary bg-indigo-50 font-medium text-primary';

/**
 * URL-driven filter bar. Receives the parsed params as props (no
 * `useSearchParams`), so it can be rendered synchronously and every change is a
 * plain `router.push` to an `eventListHref`. Its `data-pending` attribute lets
 * the results area dim via `group-has-data-pending:`.
 */
export function EventFilters({ params, categoryCounts, organizerName }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [query, setQuery] = useState(params.q);
  const [syncedQuery, setSyncedQuery] = useState(params.q);

  const paramsRef = useRef(params);
  useEffect(() => {
    paramsRef.current = params;
  }, [params]);

  const navigate = useCallback(
    (href: string) => {
      startTransition(() => {
        router.push(href);
      });
    },
    [router, startTransition],
  );

  // Resync the input when the URL changes elsewhere (Clear all, back/forward).
  // Adjusting state during render is the recommended alternative to an effect.
  if (params.q !== syncedQuery) {
    setSyncedQuery(params.q);
    setQuery(params.q);
  }

  // Debounce free-text search into the URL.
  useEffect(() => {
    if (query === params.q) return;
    const timer = setTimeout(() => {
      navigate(eventListHref(paramsRef.current, { q: query }));
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, params.q, navigate]);

  const activeChips: { key: string; label: string; href: string }[] = [];
  if (params.q) {
    activeChips.push({
      key: 'q',
      label: `“${params.q}”`,
      href: eventListHref(params, { q: '' }),
    });
  }
  if (params.category) {
    activeChips.push({
      key: 'category',
      label: categoryLabel(params.category),
      href: eventListHref(params, { category: null }),
    });
  }
  if (params.when !== 'any') {
    activeChips.push({
      key: 'when',
      label: whenLabel(params.when),
      href: eventListHref(params, { when: 'any' }),
    });
  }
  if (params.sort !== 'date') {
    activeChips.push({
      key: 'sort',
      label: `Sort: ${sortLabel(params.sort)}`,
      href: eventListHref(params, { sort: 'date' }),
    });
  }
  if (params.organizer) {
    activeChips.push({
      key: 'organizer',
      label: organizerName ? `By ${organizerName}` : 'One organizer',
      href: eventListHref(params, { organizer: null }),
    });
  }

  return (
    <section
      aria-label="Filter events"
      className="card p-4 space-y-4"
      data-pending={isPending ? '' : undefined}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex-1">
          <label htmlFor="event-search" className="sr-only">
            Search events
          </label>
          <input
            id="event-search"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search events, places, organizers"
            autoComplete="off"
            className="input-field"
          />
        </div>

        <div className="flex gap-3">
          <div>
            <label htmlFor="event-when" className="sr-only">
              When
            </label>
            <select
              id="event-when"
              value={params.when}
              onChange={(event) =>
                navigate(
                  eventListHref(params, {
                    when: event.target.value as WhenFilter,
                  }),
                )
              }
              className="input-field w-auto"
            >
              {WHEN_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="event-sort" className="sr-only">
              Sort by
            </label>
            <select
              id="event-sort"
              value={params.sort}
              onChange={(event) =>
                navigate(
                  eventListHref(params, {
                    sort: event.target.value as EventListParams['sort'],
                  }),
                )
              }
              className="input-field w-auto"
            >
              {SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {EVENT_CATEGORIES.map((category) => {
          const active = params.category === category.value;
          return (
            <button
              key={category.value}
              type="button"
              aria-pressed={active}
              onClick={() =>
                navigate(
                  eventListHref(params, {
                    category: active ? null : category.value,
                  }),
                )
              }
              className={`${CHIP_BASE} ${active ? CHIP_ACTIVE : CHIP_IDLE}`}
            >
              {category.label}
              <span className="text-[0.7rem] tabular-nums opacity-70">
                {categoryCounts[category.value] ?? 0}
              </span>
            </button>
          );
        })}
      </div>

      {activeChips.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
          {activeChips.map((chip) => (
            <span
              key={chip.key}
              className="inline-flex items-center gap-1.5 rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1 text-xs text-indigo-700"
            >
              {chip.label}
              <button
                type="button"
                onClick={() => navigate(chip.href)}
                aria-label={`Remove filter: ${chip.label}`}
                className="cursor-pointer font-medium hover:text-indigo-900"
              >
                ×
              </button>
            </span>
          ))}
          <button
            type="button"
            onClick={() => navigate(eventListHref(DEFAULT_EVENT_LIST_PARAMS))}
            className="cursor-pointer text-xs text-muted underline underline-offset-2 hover:text-foreground"
          >
            Clear all
          </button>
        </div>
      )}
    </section>
  );
}
