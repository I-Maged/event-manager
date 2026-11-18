import Link from 'next/link';
import { auth } from '@/lib/auth/server';
import { EventCard } from '@/components/EventCard';
import { EventFilters } from '@/components/EventFilters';
import { NaturalLanguageSearch } from '@/components/NaturalLanguageSearch';
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
import { getRecommendedEvents } from '@/lib/ai/recommendations';
import { semanticEventSearch } from '@/lib/ai/semantic-events';
import { enforceRateLimit } from '@/lib/rate-limit';
import { prisma } from '@/db';

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
  const raw = await searchParams
  const params = parseEventListParams(raw)
  const view = (Array.isArray(raw.view) ? raw.view[0] : raw.view) === 'recommended' ? 'recommended' : 'browse'
  const nlFlag = (Array.isArray(raw.nl) ? raw.nl[0] : raw.nl) === '1'

  const { data: session } = await auth.getSession()
  const myId = session?.user?.id ?? null

  let recommended = view === 'recommended' && !!myId
  if (recommended && myId) {
    const limited = await enforceRateLimit('recommendation', myId)
    if (limited) recommended = false
  }
  let events: Awaited<ReturnType<typeof getPublicEventsPage>>['events']
  let total: number
  let page: number
  let pageCount: number
  let semanticUnavailable = false

  if (recommended) {
    const r = await getRecommendedEvents({ userId: myId!, page: params.page, pageSize: PAGE_SIZE })
    events = r.events
    total = r.total
    page = params.page
    pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))
    try {
      await prisma.aIUsage.create({ data: { userId: myId!, feature: 'recommendations', model: process.env.OPENROUTER_EMBEDDING_MODEL ?? 'nvidia/nemotron-3.5-embed-1b:free' } })
    } catch {}
  } else if (nlFlag && params.q) {
    const r = await semanticEventSearch(params, params.page, PAGE_SIZE)
    events = r.events
    total = r.total
    page = r.page
    pageCount = r.pageCount
    semanticUnavailable = r.semanticUnavailable
  } else {
    const r = await getPublicEventsPage(params)
    events = r.events
    total = r.total
    page = r.page
    pageCount = r.pageCount
  }

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

      <NaturalLanguageSearch />

      <div className="flex gap-2">
        <Link
          href="/events"
          className={`btn-secondary text-sm ${view === 'browse' ? 'ring-2 ring-primary' : ''}`}
        >
          Browse
        </Link>
        {myId ? (
          <Link
            href="/events?view=recommended"
            className={`btn-secondary text-sm ${view === 'recommended' ? 'ring-2 ring-primary' : ''}`}
          >
            For you
          </Link>
        ) : null}
      </div>

      {nlFlag && (
        <div className="card p-3 text-sm text-muted">
          Showing results interpreted from your AI search. Adjust filters as needed.
        </div>
      )}
      {nlFlag && semanticUnavailable && (
        <div className="card p-3 text-sm text-amber-600">
          Semantic search is temporarily unavailable; showing text matches only.
        </div>
      )}

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
