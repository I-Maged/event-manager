'use client';

import { useCallback, useState } from 'react';
import { isFrameworkControlFlow } from '@/lib/action-errors';

export const GENERIC_ACTION_ERROR = 'Something went wrong. Please retry.';

/**
 * Pending + error state for a single client-side Server Function call.
 *
 * The point of `run` is that it cannot leave a control permanently disabled:
 * `setPending(false)` lives in a `finally`, so it runs even when the action
 * rejects, and a rejection is turned into a visible message instead of a
 * silently swallowed promise.
 *
 * Framework control flow is re-thrown rather than swallowed — see
 * `isFrameworkControlFlow`. `reset` differs from React's `reset` in that it
 * clears the error before each attempt, so a stale message never outlives a
 * retry.
 */
export function useActionFeedback() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async <T,>(
      fn: () => Promise<T>,
      fallback: string = GENERIC_ACTION_ERROR,
    ): Promise<T | null> => {
      setError(null);
      setPending(true);
      try {
        return await fn();
      } catch (thrown) {
        if (isFrameworkControlFlow(thrown)) throw thrown;
        setError(fallback);
        return null;
      } finally {
        setPending(false);
      }
    },
    [],
  );

  return { pending, error, setError, run };
}
