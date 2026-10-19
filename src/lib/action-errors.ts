/**
 * Next models `redirect()` and `notFound()` inside Server Functions as
 * control-flow exceptions carrying a `digest`, not as failures. A client
 * `catch` around a Server Function call must let them through: a session
 * expiry has to navigate to the sign-in page, not render
 * "Something went wrong".
 *
 * Digest shapes (from the installed Next runtime):
 *   - `redirect()` -> `NEXT_REDIRECT;replace;/auth/sign-in;307;`
 *     (next/dist/client/components/redirect-error.js)
 *   - `notFound()` -> `NEXT_HTTP_ERROR_FALLBACK;404`
 *     (next/dist/client/components/http-access-fallback/…)
 *
 * Re-throwing is enough to complete the navigation: Next installs a global
 * `unhandledrejection` listener for exactly this
 * (next/dist/client/components/app-router.js, `handleUnhandledRedirect`).
 */
export function isFrameworkControlFlow(error: unknown): boolean {
  const digest = (error as { digest?: unknown } | null)?.digest;
  if (typeof digest !== 'string') return false;
  return (
    digest.startsWith('NEXT_REDIRECT') ||
    digest.startsWith('NEXT_HTTP_ERROR_FALLBACK')
  );
}
