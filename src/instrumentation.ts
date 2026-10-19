import type { Instrumentation } from 'next';

function digestOf(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const digest = (error as { digest?: unknown }).digest;
  return typeof digest === 'string' ? digest : undefined;
}

/**
 * One structured line per server-side failure, so the `error.digest` shown by
 * an error boundary can be correlated with the real message in the logs.
 *
 * This runs for render, route-handler, Server Action and proxy errors. Router
 * control flow (`redirect()` / `notFound()`) never reaches this hook — Next
 * short-circuits router errors before reporting.
 *
 * Request headers are intentionally not logged: they carry cookies/session.
 */
export const onRequestError: Instrumentation.onRequestError = async (
  error,
  request,
  context,
) => {
  try {
    console.error('[request error]', {
      message: error instanceof Error ? error.message : String(error),
      digest: digestOf(error),
      method: request.method,
      path: request.path,
      routePath: context.routePath,
      routeType: context.routeType,
      renderSource: context.renderSource,
    });
  } catch {
    // Reporting must never break the request path.
  }
};
