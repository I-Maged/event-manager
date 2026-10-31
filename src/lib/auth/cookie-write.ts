import type { CookieOptions } from '@neondatabase/auth/server';

/**
 * Cookie writes are only legal in a Server Action or Route Handler. Next 16
 * enforces that at runtime, so any library that tries to refresh a cookie while
 * rendering a Server Component throws and the page renders the error boundary
 * (F1: `Cookies can only be modified in a Server Action or Route Handler`,
 * digest `1420334223`, observed on `/events/[id]` and `/auth/sign-in`).
 *
 * The Neon Auth SDK writes refreshed session cookies from `auth.getSession()`.
 * During a render that write is impossible, but the session itself is still
 * valid — the refresh can be persisted by a later auth-route or middleware
 * request. So the write is skipped (and logged) instead of failing the page;
 * every other database/framework error is still surfaced.
 */

const READ_ONLY_COOKIE_MESSAGE =
  'Cookies can only be modified in a Server Action or Route Handler';

export type SetCookie = (
  name: string,
  value: string,
  options: CookieOptions,
) => void | Promise<void>;

/** True for Next's deliberate render-time cookie mutation rejection. */
export function isCookiesReadOnlyError(error: unknown): boolean {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : '';
  return message.includes(READ_ONLY_COOKIE_MESSAGE);
}

/**
 * Wrap a cookie writer so a render-time refresh is skipped rather than thrown.
 * `onSkipped` is called once per suppressed write (name + original error) so the
 * skip is observable without leaking cookie values.
 */
export function createSafeCookieWriter(
  write: SetCookie,
  onSkipped: (name: string, error: Error) => void,
): SetCookie {
  return async (name, value, options) => {
    try {
      await write(name, value, options);
    } catch (error) {
      if (!isCookiesReadOnlyError(error)) throw error;
      onSkipped(
        name,
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  };
}
