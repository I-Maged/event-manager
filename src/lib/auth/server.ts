import { cookies, headers } from 'next/headers';
import {
  createAuthServer,
  extractNeonAuthCookies,
  type CookieOptions,
  type RequestContext,
} from '@neondatabase/auth/server';
import { createNeonAuth } from '@neondatabase/auth/next/server';
import { createSafeCookieWriter } from '@/lib/auth/cookie-write';
import { requireEnv } from '@/lib/env';

/**
 * True for Next.js's intentional "hanging promise" rejection — a runtime read
 * (here `cookies()`) that Next rejects once a static prerender is complete.
 * See `HangingPromiseRejectionError` in
 * `next/dist/server/dynamic-rendering-utils`.
 */
function isHangingPromiseRejection(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'digest' in error &&
    (error as { digest?: unknown }).digest === 'HANGING_PROMISE_REJECTION'
  );
}

// The Neon Auth SDK probes its session-data cookie cache before every
// `getSession()` call. On prerendered routes that probe reads `cookies()`,
// which Next rejects on purpose once the static shell is captured, so the SDK
// logs a benign "[neon-auth] Cookie validation error" warning per route at
// build time. Drop only that framework signal; forward every other warning.
const logger = {
  warn(message: string, meta?: Record<string, unknown>) {
    if (isHangingPromiseRejection(meta?.err)) return;
    console.warn(message, meta);
  },
};

const baseUrl = requireEnv('NEON_AUTH_BASE_URL');
const cookieSecret = requireEnv('NEON_AUTH_COOKIE_SECRET');

/**
 * Route handlers and middleware: cookies are writable there, so this instance
 * uses the stock Next.js adapter (it also builds the auth proxy and the
 * session-refresh middleware used by `src/proxy.ts`).
 */
export const authHandler = createNeonAuth({
  baseUrl,
  cookies: { secret: cookieSecret },
  logger,
});

/**
 * Request context for render-time reads (`auth.getSession()` in pages,
 * components and server actions).
 *
 * The SDK refreshes the session cookie whenever its cache is stale or the
 * upstream rotates the token. During an RSC render Next forbids that write, and
 * before this guard the thrown error replaced the page with the error boundary
 * (F1). The writer skips the write and logs it; the session data returned by
 * the same call is still valid, and the next request that may write cookies
 * (auth route, middleware, server action) persists the refresh.
 */
async function createRenderSafeContext(): Promise<RequestContext> {
  const cookieStore = await cookies();
  const headerStore = await headers();

  const setCookie = createSafeCookieWriter(
    (name, value, options: CookieOptions) => {
      cookieStore.set(name, value, options);
    },
    (name) => {
      console.warn(
        '[neon-auth] skipped session cookie refresh during render',
        { cookie: name },
      );
    },
  );

  return {
    getCookies: () => extractNeonAuthCookies(headerStore),
    setCookie,
    getHeader: (name) => headerStore.get(name) ?? null,
    getOrigin: () =>
      headerStore.get('origin') ||
      headerStore.get('referer')?.split('/').slice(0, 3).join('/') ||
      '',
    getFramework: () => 'nextjs',
  };
}

/**
 * Session reader for the app tree. Same surface as the adapter for the calls
 * used here (`getSession`), but with the render-safe cookie context.
 */
export const auth = createAuthServer({
  baseUrl,
  cookieSecret,
  context: createRenderSafeContext,
  log: logger,
});
