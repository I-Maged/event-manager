import Link from 'next/link';
import { CalendarLinks } from '@/components/CalendarLinks';
import { categoryLabel } from '@/lib/categories';
import { categoryFilterHref } from '@/lib/discovery';
import { type OrganizerEventStats } from '@/lib/events';
import { formatEventDate } from '@/lib/time';

type Props = {
  row: OrganizerEventStats;
};

/**
 * Organizer-facing event card: RSVP funnel, category badge, fill-rate bar, and
 * the manage/export/calendar actions. Server-safe (plain anchors, no state).
 */
export function OrganizerEventCard({ row }: Props) {
  const { event, counts, fillRate } = row;
  const fillPct = fillRate != null ? Math.round(fillRate * 100) : null;
  const barPct = fillPct != null ? Math.min(100, fillPct) : null;
  const goingLine =
    event.maxAttendees != null
      ? `${counts.GOING}/${event.maxAttendees} going`
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

      <div className="flex items-center gap-2 flex-wrap">
        <Link
          href={categoryFilterHref(event.category)}
          className="badge-organizer hover:underline"
        >
          {categoryLabel(event.category)}
        </Link>
      </div>

      <p className="text-sm text-muted">
        {formatEventDate(event.date, event.timeZone)} · {event.location}
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

      {barPct != null && (
        <div className="space-y-1.5 pt-1">
          <p className="text-xs text-muted">{fillPct}% full</p>
          <div
            role="progressbar"
            aria-valuenow={barPct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Fill rate"
            className="h-2 w-full overflow-hidden rounded-full bg-border"
          >
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${barPct}%` }}
            />
          </div>
        </div>
      )}

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
