import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth/server';
import { getOrganizerEvents, type OrganizerEventStats } from '@/lib/events';
import {
  dashboardHref,
  hasDashboardQuery,
  parseDashboardParams,
  type DashboardParams,
  type RawSearchParams,
} from '@/lib/discovery';
import { categoryLabel } from '@/lib/categories';
import { DashboardFilters } from '@/components/DashboardFilters';
import { OrganizerEventCard } from '@/components/OrganizerEventCard';

export const metadata = {
  title: 'My events | EventPlanner',
};

// Session-gated + live RSVP counts: render on demand.
export const instant = false;

type DashboardStats = {
  upcoming: number;
  past: number;
  totalGoing: number;
  totalWishlisted: number;
  avgFillPct: number | null;
};

/** Headline numbers for every event the organizer owns (view-independent). */
function dashboardStats(
  upcoming: OrganizerEventStats[],
  past: OrganizerEventStats[],
): DashboardStats {
  let totalGoing = 0;
  let totalWishlisted = 0;
  let fillSum = 0;
  let fillCount = 0;

  for (const { counts, fillRate } of [...upcoming, ...past]) {
    totalGoing += counts.GOING;
    totalWishlisted += counts.WAITLISTED;
    if (fillRate != null) {
      fillSum += fillRate;
      fillCount += 1;
    }
  }

  return {
    upcoming: upcoming.length,
    past: past.length,
    totalGoing,
    totalWishlisted,
    avgFillPct: fillCount > 0 ? Math.round((fillSum / fillCount) * 100) : null,
  };
}

/** Rows for the selected tab. `all` keeps upcoming ahead of past. */
function rowsForView(
  upcoming: OrganizerEventStats[],
  past: OrganizerEventStats[],
  view: DashboardParams['view'],
): OrganizerEventStats[] {
  if (view === 'upcoming') return upcoming;
  if (view === 'past') return past;
  return [...upcoming, ...past];
}

/** Case-insensitive search over the fields shown on a card. */
function matchesQuery(row: OrganizerEventStats, q: string): boolean {
  const needle = q.toLowerCase();
  const { event } = row;
  return (
    event.title.toLowerCase().includes(needle) ||
    event.description.toLowerCase().includes(needle) ||
    event.location.toLowerCase().includes(needle) ||
    categoryLabel(event.category).toLowerCase().includes(needle)
  );
}

/**
 * In-memory sort. `date` keeps the fetch order (`getOrganizerEvents` already
 * returns upcoming soonest-first, past most-recent-first, combined upcoming
 * then past); the other modes reorder the whole set.
 */
function sortRows(
  rows: OrganizerEventStats[],
  sort: DashboardParams['sort'],
): OrganizerEventStats[] {
  const sorted = [...rows];
  switch (sort) {
    case 'fill':
      sorted.sort((a, b) => {
        const af = a.fillRate ?? -1;
        const bf = b.fillRate ?? -1;
        if (bf !== af) return bf - af;
        return a.event.date.getTime() - b.event.date.getTime();
      });
      break;
    case 'newest':
      sorted.sort(
        (a, b) => b.event.createdAt.getTime() - a.event.createdAt.getTime(),
      );
      break;
    case 'date':
    default:
      break;
  }
  return sorted;
}

function StatsRow({ stats }: { stats: DashboardStats }) {
  const items = [
    { label: 'Upcoming', value: String(stats.upcoming) },
    { label: 'Total going', value: String(stats.totalGoing) },
    { label: 'Total wishlisted', value: String(stats.totalWishlisted) },
    { label: 'Past', value: String(stats.past) },
    {
      label: 'Avg fill',
      value: stats.avgFillPct != null ? `${stats.avgFillPct}%` : '—',
    },
  ];

  return (
    <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
      {items.map((item) => (
        <div key={item.label} className="card p-4 space-y-1">
          <dt className="text-xs text-muted">{item.label}</dt>
          <dd className="text-2xl font-semibold tabular-nums">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function ViewEmptyState({ params }: { params: DashboardParams }) {
  if (hasDashboardQuery(params)) {
    return (
      <div className="card p-8 text-center space-y-4">
        <p className="text-muted">
          No events match &ldquo;{params.q}&rdquo;.
        </p>
        <Link
          href={dashboardHref(params, { q: '' })}
          className="btn-secondary inline-flex"
        >
          Clear search
        </Link>
      </div>
    );
  }

  if (params.view === 'past') {
    return (
      <div className="card p-8 text-center space-y-4">
        <p className="text-muted">No past events yet.</p>
      </div>
    );
  }

  return (
    <div className="card p-8 text-center space-y-4">
      <p className="text-muted">No upcoming events.</p>
      <Link href="/events/new" className="btn-primary inline-flex">
        Plan your next event
      </Link>
    </div>
  );
}

export default async function MyEventsPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const params = parseDashboardParams(await searchParams);

  const { data: session } = await auth.getSession();
  const userId = session?.user?.id;
  if (!userId) redirect('/auth/sign-in');

  const { upcoming, past } = await getOrganizerEvents(userId);

  if (upcoming.length === 0 && past.length === 0) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-bold">My events</h1>
          <Link href="/events/new" className="btn-primary text-sm">
            Create event
          </Link>
        </div>
        <div className="card p-8 text-center space-y-4">
          <p className="text-muted">
            You haven&apos;t organized any events yet.
          </p>
          <Link href="/events/new" className="btn-primary inline-flex">
            Be the first to create one
          </Link>
        </div>
      </div>
    );
  }

  const stats = dashboardStats(upcoming, past);
  const viewCounts = {
    upcoming: upcoming.length,
    past: past.length,
    all: upcoming.length + past.length,
  };

  const viewRows = rowsForView(upcoming, past, params.view);
  const searched = params.q
    ? viewRows.filter((row) => matchesQuery(row, params.q))
    : viewRows;
  const rows = sortRows(searched, params.sort);

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">My events</h1>
        <Link href="/events/new" className="btn-primary text-sm">
          Create event
        </Link>
      </div>

      <StatsRow stats={stats} />

      <div className="group space-y-6">
        <DashboardFilters params={params} viewCounts={viewCounts} />

        <div className="space-y-6 transition-opacity group-has-data-pending:opacity-50">
          {rows.length > 0 ? (
            <ul className="grid gap-4 md:grid-cols-2">
              {rows.map((row) => (
                <OrganizerEventCard key={row.event.id} row={row} />
              ))}
            </ul>
          ) : (
            <ViewEmptyState params={params} />
          )}
        </div>
      </div>
    </div>
  );
}
