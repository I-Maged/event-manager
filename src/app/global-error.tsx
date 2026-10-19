'use client';

import { ErrorFallback } from '@/components/ErrorFallback';
// This entry replaces the root layout, so it does not inherit the layout's
// global stylesheet import; without this the `.card` / `.btn-primary` classes
// used by ErrorFallback would render unstyled.
import './globals.css';

/**
 * Last-resort boundary for errors thrown in the root layout (or the root
 * template). It replaces the whole document, so it must render its own
 * `<html>` / `<body>`.
 *
 * Client Components cannot export `metadata`, so the title is set with React's
 * `<title>` element instead.
 */
export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <html lang="en">
      <body className="antialiased bg-background text-foreground">
        <title>Something went wrong | EventPlanner</title>
        <div className="container mx-auto px-4 py-8">
          <ErrorFallback
            error={error}
            retry={retry}
            description="The app hit an unexpected error. Trying again usually fixes it."
          />
        </div>
      </body>
    </html>
  );
}
