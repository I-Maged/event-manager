import { googleCalendarUrl, type CalendarEventInput } from '@/lib/calendar';

type Props = {
  event: CalendarEventInput;
  className?: string;
};

/**
 * Plain-anchor calendar actions (no client JS). Server-safe: works from
 * event detail, my-events, and wishlist cards.
 */
export function CalendarLinks({ event, className }: Props) {
  const googleUrl = googleCalendarUrl(event);
  return (
    <span
      className={
        className ?? 'inline-flex flex-wrap items-center gap-x-3 gap-y-1'
      }
    >
      <a
        href={`/api/events/${event.id}/calendar`}
        className="text-primary hover:underline"
      >
        Download .ics
      </a>
      <a
        href={googleUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="text-primary hover:underline"
      >
        Add to Google
      </a>
    </span>
  );
}
