'use client';

import { ErrorFallback } from '@/components/ErrorFallback';

/**
 * Root-segment boundary: catches render/data errors in every page under the
 * root layout, so the navbar and page shell survive.
 *
 * Errors thrown in `layout.tsx` itself are not caught here — that is
 * `global-error.tsx`. This file must stay a Client Component and must not
 * export `metadata` or `instant` (`instant` throws in Client Components).
 */
export default function AppError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return <ErrorFallback error={error} retry={retry} />;
}
