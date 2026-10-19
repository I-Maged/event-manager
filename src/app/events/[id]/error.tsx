'use client';

import Link from 'next/link';
import { ErrorFallback } from '@/components/ErrorFallback';

/**
 * Detail-segment boundary, so a roster/comment read failure degrades this
 * route instead of 500-ing it. It also covers `/events/[id]/edit`, which has no
 * boundary of its own.
 *
 * Trade-off: a segment boundary replaces the whole segment, not just the
 * `<Suspense>` section that failed — the event header is replaced too. True
 * per-section isolation needs a `catchError` wrapper per section (deferred).
 */
export default function EventDetailError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <div className="space-y-4 max-w-2xl mx-auto">
      <Link href="/events" className="text-sm text-primary hover:underline">
        ← All events
      </Link>
      <ErrorFallback
        error={error}
        retry={retry}
        description="We couldn't load this event. It may be temporary."
      />
    </div>
  );
}
