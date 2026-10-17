import Link from 'next/link';
import { auth } from '@/lib/auth/server';
import { EventCard } from '@/components/EventCard';
import { EventFilters } from '@/components/EventFilters';
import { Pagination } from '@/components/Pagination';
import {
  hasNarrowingFilters,
  parseEventListParams,
  type RawSearchParams,
} from '@/lib/discovery';
import {
  getCategoryCounts,
  getGoingCounts,
  getOrganizerDisplayName,
  getPublicEventsPage,
  PAGE_SIZE,
} from '@/lib/events';

export const metadata = {
  title: 'Browse events | EventPlanner',
};

// Auth-gated counts and frequently-changing RSVP data: render on demand.
export const instant = false;

export default async function EventsPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const params = parseEventListParams(await searchParams);

  const { data: session } = await auth.getSession();
  const myId = session?.user?.id ?? null;

  const { events, total, page, pageCount } = await getPublicEventsPage(params);

  const [goingCounts, categoryCounts, organizerName] = await Promise.all([
    getGoingCounts(events.map((event) => event.id)),
    getCategoryCounts(),
    params.organizer
      ? getOrganizerDisplayName(params.organizer)
      : Promise.resolve(null),
  ]);

  const start = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const end = Math.min(page * PAGE_SIZE, total);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Browse events</h1>
        <Link href="/events/new" className="btn-primary text-sm">
          Create event
        </Link>
      </div>

      <div className="group space-y-6">
        <EventFilters
          params={params}
          categoryCounts={categoryCounts}
          organizerName={organizerName}
        />

        <div className="space-y-6 transition-opacity group-has-data-pending:opacity-50">
          {total > 0 && (
            <p className="text-sm text-muted" role="status">
              Showing {start}–{end} of {total} event{total === 1 ? '' : 's'}
            </p>
          )}

          {total === 0 ? (
            hasNarrowingFilters(params) ? (
              <div className="card p-8 text-center space-y-4">
                <p className="text-muted">No events match your filters.</p>
                <Link href="/events" className="btn-secondary inline-flex">
                  Clear all filters
                </Link>
              </div>
            ) : (
              <div className="card p-8 text-center space-y-4">
                <p className="text-muted">No upcoming public events yet.</p>
                <Link href="/events/new" className="btn-primary inline-flex">
                  Be the first to create one
                </Link>
              </div>
            )
          ) : (
            <>
              <ul className="grid gap-4 md:grid-cols-2">
                {events.map((event) => (
                  <EventCard
                    key={event.id}
                    event={event}
                    going={goingCounts.get(event.id) ?? 0}
                    isMine={myId !== null && event.userId === myId}
                  />
                ))}
              </ul>
              <Pagination params={params} page={page} pageCount={pageCount} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
