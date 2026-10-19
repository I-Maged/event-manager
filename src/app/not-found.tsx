import Link from 'next/link';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Page not found | EventPlanner',
};

/**
 * Root not-found boundary. It renders inside the root layout (so the navbar
 * and page container are inherited) and handles two cases:
 *
 * - `notFound()` thrown from a route segment that has no closer boundary
 * - any URL that matches no route at all
 *
 * A Server Component, so the homepage button is a plain `<Link>`; no client
 * JS is needed. Next injects `<meta name="robots" content="noindex" />` for
 * 404 responses automatically.
 */
export default function NotFound() {
  return (
    <div className="card p-8 text-center space-y-4 max-w-xl mx-auto">
      <p className="text-sm font-medium uppercase tracking-wide text-muted">
        404
      </p>
      <h1 className="text-2xl font-bold">Page not found</h1>
      <p className="text-sm text-muted">
        We couldn&apos;t find the page you were looking for. It may have been
        moved or deleted.
      </p>
      <div className="flex flex-wrap justify-center gap-3">
        <Link href="/" className="btn-primary text-sm">
          Go to homepage
        </Link>
        <Link href="/events" className="btn-secondary text-sm">
          Browse events
        </Link>
      </div>
    </div>
  );
}
