import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth/server';
import {
  formatEventDate,
  getOrganizerEvents,
  type OrganizerEventStats,
} from '@/lib/events';
import { CalendarLinks } from '@/components/CalendarLinks';

export const metadata = {
  title: 'My events | EventPlanner',
};

// Session-gated + live RSVP counts: render on demand.
export const instant = false;

function EventCard({ row }: { row: OrganizerEventStats }) {
  const { event, counts, fillRate } = row;
  const goingLine =
    event.maxAttendees != null
      ? `${counts.GOING}/${event.maxAttendees} going${fillRate != null ? ` (${Math.round(fillRate * 100)}%)` : ''}`
      : `${counts.GOING} going`;
  return (
    <li className="card p-6 space-y-2">
      <div className="flex items-start justify-between gap-3">
        <Link
          href={`/events/${event.id}`}
          className="text-xl font-semibold text-primary hover:underline"
        >
          {event.title}
        </Link>
        {!event.isPublic && (
          <span className="shrink-0 rounded-full border border-border px-2.5 py-1 text-xs text-muted">
            Private
          </span>
        )}
      </div>
      <p className="text-sm text-muted">
        {formatEventDate(event.date)} · {event.location}
      </p>
      <p className="text-sm">
        {goingLine}
        {counts.WAITLISTED > 0 && (
          <span className="ml-2 rounded-full border border-border px-2 py-0.5 text-xs text-muted">
            {counts.WAITLISTED} on wishlist
          </span>
        )}
      </p>
      <p className="text-xs text-muted">
        {counts.MAYBE} maybe · {counts.NOT_GOING} can&apos;t go
      </p>
      <div className="flex flex-wrap gap-3 pt-1 text-sm">
        <Link
          href={`/events/${event.id}`}
          className="text-primary hover:underline"
        >
          View
        </Link>
        <Link
          href={`/events/${event.id}/edit`}
          className="text-primary hover:underline"
        >
          Edit
        </Link>
        <a
          href={`/api/events/${event.id}/attendees`}
          className="text-primary hover:underline"
        >
          Export CSV
        </a>
        <CalendarLinks event={event} />
      </div>
    </li>
  );
}

export default async function MyEventsPage() {
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

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">My events</h1>
        <Link href="/events/new" className="btn-primary text-sm">
          Create event
        </Link>
      </div>

      {upcoming.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-xl font-semibold">
            Upcoming ({upcoming.length})
          </h2>
          <ul className="grid gap-4 md:grid-cols-2">
            {upcoming.map((row) => (
              <EventCard key={row.event.id} row={row} />
            ))}
          </ul>
        </section>
      )}

      {past.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-xl font-semibold">Past ({past.length})</h2>
          <ul className="grid gap-4 md:grid-cols-2">
            {past.map((row) => (
              <EventCard key={row.event.id} row={row} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
