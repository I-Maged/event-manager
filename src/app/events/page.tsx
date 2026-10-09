import Link from 'next/link';
import { auth } from '@/lib/auth/server';
import {
  formatEventDate,
  getGoingCounts,
  getOrganizerDisplayName,
  getPublicUpcomingEvents,
  organizerAccentClass,
  spotsLeft,
} from '@/lib/events';

export const metadata = {
  title: 'Browse events | EventPlanner',
};

// Auth-gated counts and frequently-changing RSVP data: render on demand.
export const instant = false;

export default async function EventsPage({
  searchParams,
}: {
  searchParams: Promise<{ organizer?: string }>;
}) {
  const { organizer } = await searchParams;
  const { data: session } = await auth.getSession();
  const myId = session?.user?.id ?? null;

  const events = await getPublicUpcomingEvents(organizer);
  const goingCounts = await getGoingCounts(events.map((e) => e.id));
  const filterName = organizer
    ? await getOrganizerDisplayName(organizer)
    : null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Upcoming events</h1>
        <Link href="/events/new" className="btn-primary text-sm">
          Create event
        </Link>
      </div>

      {organizer && (
        <div className="card p-4 flex items-center justify-between gap-3">
          <p className="text-sm">
            Showing events by{' '}
            <span className="font-semibold">
              {filterName ?? 'this organizer'}
            </span>
          </p>
          <Link href="/events" className="text-sm text-primary hover:underline">
            Clear filter
          </Link>
        </div>
      )}

      {events.length === 0 ? (
        <div className="card p-8 text-center space-y-4">
          <p className="text-muted">
            {organizer
              ? 'No upcoming public events by this organizer.'
              : 'No upcoming public events yet.'}
          </p>
          <Link href="/events/new" className="btn-primary inline-flex">
            Be the first to create one
          </Link>
        </div>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2">
          {events.map((event) => {
            const going = goingCounts.get(event.id) ?? 0;
            const left = spotsLeft(event, going);
            const isMine = myId !== null && event.userId === myId;
            return (
              <li
                key={event.id}
                className={`card p-6 space-y-2 ${isMine ? 'own-event-accent' : organizerAccentClass(event.userId)}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <Link
                    href={`/events/${event.id}`}
                    className="text-xl font-semibold text-primary hover:underline"
                  >
                    {event.title}
                  </Link>
                  {left !== null && (
                    <span className="shrink-0 rounded-full border border-border px-2.5 py-1 text-xs text-muted">
                      {left > 0 ? `${left} spot${left === 1 ? '' : 's'} left` : 'Full'}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  {isMine ? (
                    <span className="badge-own">Your event</span>
                  ) : (
                    event.organizerName && (
                      <>
                        <span className="badge-organizer">
                          By {event.organizerName}
                        </span>
                        <Link
                          href={`/events?organizer=${event.userId}`}
                          className="text-xs text-primary hover:underline"
                        >
                          More by {event.organizerName}
                        </Link>
                      </>
                    )
                  )}
                </div>
                <p className="text-sm text-muted">
                  {formatEventDate(event.date)} · {event.location}
                </p>
                <p className="text-sm line-clamp-2">{event.description}</p>
                <p className="text-xs text-muted">
                  {going} going
                  {event.maxAttendees != null && ` · cap ${event.maxAttendees}`}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
