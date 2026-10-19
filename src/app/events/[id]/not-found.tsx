import Link from 'next/link';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Event not found | EventPlanner',
};

/**
 * Closest not-found boundary for `/events/[id]` and `/events/[id]/edit`.
 *
 * `page.tsx` calls `notFound()` both when the event is missing and when
 * `canViewEvent` denies access, so the copy must stay ambiguous: saying
 * "this event is private" would leak the existence of private events.
 */
export default function EventNotFound() {
  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <Link href="/events" className="text-sm text-primary hover:underline">
        ← All events
      </Link>
      <div className="card p-8 text-center space-y-4 max-w-xl mx-auto">
        <h1 className="text-2xl font-bold">Event not found</h1>
        <p className="text-sm text-muted">
          This event doesn&apos;t exist, or you don&apos;t have access to it.
        </p>
        <div className="flex flex-wrap justify-center gap-3">
          <Link href="/events" className="btn-primary text-sm">
            Browse events
          </Link>
          <Link href="/" className="btn-secondary text-sm">
            Go to homepage
          </Link>
        </div>
      </div>
    </div>
  );
}
