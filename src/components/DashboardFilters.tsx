'use client';

import {
  startTransition,
  useCallback,
  useEffect,
  useOptimistic,
  useRef,
  useState,
} from 'react';
import { useRouter } from 'next/navigation';
import {
  DASHBOARD_SORT_OPTIONS,
  DASHBOARD_VIEW_OPTIONS,
  dashboardHref,
  type DashboardParams,
  type DashboardSort,
  type DashboardView,
} from '@/lib/discovery';

type Props = {
  params: DashboardParams;
  viewCounts: Record<DashboardView, number>;
};

const SEARCH_DEBOUNCE_MS = 300;

const TAB_BASE =
  'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs cursor-pointer transition-colors';
const TAB_IDLE =
  'border-border text-muted hover:border-primary hover:text-primary';
const TAB_ACTIVE = 'border-primary bg-indigo-50 font-medium text-primary';

/**
 * URL-driven control bar for the organizer dashboard. Receives the parsed
 * params as props (no `useSearchParams`), so it renders synchronously and every
 * change is a plain `router.push` to a `dashboardHref`. Its `data-pending`
 * attribute lets the results area dim via `group-has-data-pending:`.
 */
export function DashboardFilters({ params, viewCounts }: Props) {
  const router = useRouter();
  const [isPending, setIsPending] = useOptimistic(false);
  const [query, setQuery] = useState(params.q);
  const [syncedQuery, setSyncedQuery] = useState(params.q);

  const paramsRef = useRef(params);
  useEffect(() => {
    paramsRef.current = params;
  }, [params]);

  const navigate = useCallback(
    (href: string) => {
      startTransition(async () => {
        setIsPending(true);
        router.push(href);
      });
    },
    [router, setIsPending],
  );

  // Resync the input when the URL changes elsewhere (clear, back/forward).
  // Adjusting state during render is the recommended alternative to an effect.
  if (params.q !== syncedQuery) {
    setSyncedQuery(params.q);
    setQuery(params.q);
  }

  // Debounce free-text search into the URL.
  useEffect(() => {
    if (query === params.q) return;
    const timer = setTimeout(() => {
      navigate(dashboardHref(paramsRef.current, { q: query }));
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, params.q, navigate]);

  return (
    <section
      aria-label="Filter your events"
      className="card p-4 space-y-4"
      data-pending={isPending ? '' : undefined}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex-1">
          <label htmlFor="dashboard-search" className="sr-only">
            Search your events
          </label>
          <input
            id="dashboard-search"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search your events"
            autoComplete="off"
            className="input-field"
          />
        </div>

        <div>
          <label htmlFor="dashboard-sort" className="sr-only">
            Sort by
          </label>
          <select
            id="dashboard-sort"
            value={params.sort}
            onChange={(event) =>
              navigate(
                dashboardHref(params, {
                  sort: event.target.value as DashboardSort,
                }),
              )
            }
            className="input-field w-auto"
          >
            {DASHBOARD_SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {DASHBOARD_VIEW_OPTIONS.map((option) => {
          const active = params.view === option.value;
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={active}
              onClick={() =>
                navigate(dashboardHref(params, { view: option.value }))
              }
              className={`${TAB_BASE} ${active ? TAB_ACTIVE : TAB_IDLE}`}
            >
              {option.label}
              <span className="text-[0.7rem] tabular-nums opacity-70">
                {viewCounts[option.value] ?? 0}
              </span>
            </button>
          );
        })}

        {params.q && (
          <button
            type="button"
            onClick={() => navigate(dashboardHref(params, { q: '' }))}
            aria-label={`Remove search: ${params.q}`}
            className="inline-flex items-center gap-1.5 rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1 text-xs text-indigo-700 cursor-pointer"
          >
            “{params.q}”
            <span className="font-medium hover:text-indigo-900">×</span>
          </button>
        )}
      </div>
    </section>
  );
}
