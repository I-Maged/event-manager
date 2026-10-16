import Link from 'next/link';
import { CalendarLinks } from '@/components/CalendarLinks';
import {
  formatEventDate,
  getUpcomingRsvps,
  startsInLabel,
} from '@/lib/events';
import { ensureDueReminders } from '@/lib/notifications';

/**
 * "Coming up" widget: the caller's next RSVPs, soonest first.
 * Writing due REMINDERs here is the no-cron substitute — idempotent
 * (24h dedup) and best-effort, so it never breaks this section.
 */
export async function UpcomingWidget({ userId }: { userId: string }) {
  const upcoming = await getUpcomingRsvps(userId);
  if (upcoming.length === 0) return null;
  await ensureDueReminders(userId, upcoming);

  return (
    <section className="space-y-3">
      <h2 className="text-xl font-semibold">Coming up</h2>
      <ul className="space-y-3">
        {upcoming.map(({ id, event }) => (
          <li key={id} className="card p-5 space-y-1.5">
            <div className="flex items-start justify-between gap-3">
              <Link
                href={`/events/${event.id}`}
                className="font-semibold text-primary hover:underline"
              >
                {event.title}
              </Link>
              <span className="shrink-0 rounded-full border border-border px-2.5 py-1 text-xs text-muted">
                Starts {startsInLabel(event.date).toLowerCase()}
              </span>
            </div>
            <p className="text-sm text-muted">
              {formatEventDate(event.date)} · {event.location}
            </p>
            <CalendarLinks event={event} />
          </li>
        ))}
      </ul>
    </section>
  );
}
