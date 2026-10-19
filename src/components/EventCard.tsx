import Link from 'next/link';
import type { Event } from '@/generated/prisma';
import { categoryLabel } from '@/lib/categories';
import { categoryFilterHref } from '@/lib/discovery';
import { formatEventDate } from '@/lib/time';
import { organizerAccentClass, spotsLeft } from '@/lib/events';

type Props = {
  event: Event;
  going: number;
  isMine: boolean;
};

/** Public browse card: links to the event, its category, and its organizer. */
export function EventCard({ event, going, isMine }: Props) {
  const left = spotsLeft(event, going);

  return (
    <li
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
        <Link
          href={categoryFilterHref(event.category)}
          className="badge-organizer hover:underline"
        >
          {categoryLabel(event.category)}
        </Link>
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
        {formatEventDate(event.date, event.timeZone)} · {event.location}
      </p>
      <p className="text-sm line-clamp-2">{event.description}</p>
      <p className="text-xs text-muted">
        {going} going
        {event.maxAttendees != null && ` · cap ${event.maxAttendees}`}
      </p>
    </li>
  );
}
