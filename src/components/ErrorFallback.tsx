'use client';

import { useEffect } from 'react';

type ErrorFallbackProps = {
  error: Error & { digest?: string };
  retry: () => void;
  title?: string;
  description?: string;
};

/**
 * Shared body for every route-level error boundary (`app/error.tsx`,
 * `app/global-error.tsx`, `app/events/[id]/error.tsx`).
 *
 * `retry()` re-fetches and re-renders the failed segment. `reset()` is
 * deliberately not used: it only clears the boundary state without re-fetching,
 * so it would loop straight back into the same failing server render.
 *
 * The digest is a server-generated hash, never the error message (production
 * hides those from the client), so it is safe to show. It matches the digest
 * logged by `onRequestError` in `src/instrumentation.ts`, which is what makes a
 * user report correlatable with the server log.
 */
export function ErrorFallback({
  error,
  retry,
  title = 'Something went wrong',
  description = "We couldn't load this page. It may be temporary.",
}: ErrorFallbackProps) {
  useEffect(() => {
    // Browser-side log; server-side failures are logged with the same digest
    // by `onRequestError`.
    console.error('[render error]', {
      message: error.message,
      digest: error.digest,
    });
  }, [error]);

  return (
    <div className="card p-8 text-center space-y-4 max-w-xl mx-auto">
      <h1 className="text-2xl font-bold">{title}</h1>
      <p className="text-muted text-sm">{description}</p>
      <button
        type="button"
        onClick={() => retry()}
        className="btn-primary text-sm"
      >
        Try again
      </button>
      {error.digest && (
        <p className="text-xs text-muted">
          Reference: <code className="break-all">{error.digest}</code>
        </p>
      )}
    </div>
  );
}
