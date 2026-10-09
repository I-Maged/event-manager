import Link from 'next/link';
import {
  formatEventDate,
  getGoingCounts,
  getPublicUpcomingEvents,
  spotsLeft,
} from '@/lib/events';

export const metadata = {
  title: 'Browse events | EventPlanner',
};

// Auth-gated counts and frequently-changing RSVP data: render on demand.
export const instant = false;

export default async function EventsPage() {
  const events = await getPublicUpcomingEvents();
  const goingCounts = await getGoingCounts(events.map((e) => e.id));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Upcoming events</h1>
        <Link href="/events/new" className="btn-primary text-sm">
          Create event
        </Link>
      </div>

      {events.length === 0 ? (
        <div className="card p-8 text-center space-y-4">
          <p className="text-muted">No upcoming public events yet.</p>
          <Link href="/events/new" className="btn-primary inline-flex">
            Be the first to create one
          </Link>
        </div>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2">
          {events.map((event) => {
            const going = goingCounts.get(event.id) ?? 0;
            const left = spotsLeft(event, going);
            return (
              <li key={event.id} className="card p-6 space-y-2">
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
