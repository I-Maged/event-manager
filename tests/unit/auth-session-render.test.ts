import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  NEON_AUTH_SESSION_COOKIE_NAME,
  NEON_AUTH_SESSION_DATA_COOKIE_NAME,
  createAuthServer,
  type CookieOptions,
  type RequestContext,
} from '@neondatabase/auth/server';
import { createSafeCookieWriter } from '@/lib/auth/cookie-write';

/**
 * F1 regression — an expired session cache triggers a refresh inside
 * `auth.getSession()`. The Neon Auth SDK writes the rotated cookie through the
 * adapter's `setCookie`, and during an RSC render that write throws:
 *
 *   Cookies can only be modified in a Server Action or Route Handler.
 *
 * Before the fix the throw escaped `getSession()` and the page rendered the
 * error boundary. This drives the real SDK path (real `createAuthServer`, real
 * cache validation) with only `fetch` and the cookie store simulated, so it
 * fails for exactly the reason the browser run failed.
 */

const SECRET = 'test-secret-that-is-long-enough-for-hmac-sha256';
const BASE_URL = 'https://auth.example.test';
const RENDER_ERROR = new Error(
  'Cookies can only be modified in a Server Action or Route Handler. ' +
    'Read more: https://nextjs.org/docs/app/api-reference/functions/cookies#options',
);

const SESSION_BODY = {
  session: {
    id: 'session-1',
    userId: 'user-1',
    token: 'rotated-token',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  },
  user: {
    id: 'user-1',
    email: 'attendee@example.com',
    name: 'Attendee',
    emailVerified: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
};

/** Upstream `/get-session` rotates the session token, as Better Auth does. */
function stubSessionRefresh(): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const raw =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    const url = new URL(raw);

    if (url.pathname.endsWith('/get-session')) {
      return new Response(JSON.stringify(SESSION_BODY), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          // A rotated session token: the SDK persists this before returning.
          'Set-Cookie': `${NEON_AUTH_SESSION_COOKIE_NAME}=rotated-token; Path=/; HttpOnly; Secure; SameSite=Lax`,
        },
      });
    }
    return new Response('{}', {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function contextWith(
  setCookie: (name: string, value: string, options: CookieOptions) => void,
): RequestContext {
  return {
    // A session token with no cached session_data: the SDK must go upstream.
    getCookies: () => `${NEON_AUTH_SESSION_COOKIE_NAME}=stale-token`,
    setCookie,
    getHeader: () => null,
    getOrigin: () => 'http://localhost:3200',
    getFramework: () => 'nextjs',
  };
}

function makeServer(
  setCookie: (name: string, value: string, options: CookieOptions) => void,
) {
  return createAuthServer({
    baseUrl: BASE_URL,
    cookieSecret: SECRET,
    context: () => contextWith(setCookie),
  });
}

describe('session refresh during an RSC render (F1)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('resolves the session when the cookie write is skipped, not fatal', async () => {
    const fetchMock = stubSessionRefresh();
    const skipped: string[] = [];
    const store = vi.fn(() => {
      throw RENDER_ERROR;
    });
    const setCookie = createSafeCookieWriter(store, (name) => {
      skipped.push(name);
    });

    const { data, error } = await makeServer(setCookie).getSession();

    // The refresh was attempted, could not be persisted, and did not fail.
    expect(fetchMock).toHaveBeenCalled();
    expect(store).toHaveBeenCalledWith(
      NEON_AUTH_SESSION_COOKIE_NAME,
      'rotated-token',
      expect.objectContaining({ path: '/' }),
    );
    // Both the rotated session token and the minted session-data cache are
    // render-time writes, so both are skipped.
    expect(skipped).toEqual([
      NEON_AUTH_SESSION_COOKIE_NAME,
      NEON_AUTH_SESSION_DATA_COOKIE_NAME,
    ]);
    expect(error).toBeNull();
    expect(data?.user?.id).toBe('user-1');
  });

  it('reproduces the original failure without the guard', async () => {
    stubSessionRefresh();
    const unguarded = () => {
      throw RENDER_ERROR;
    };

    // This is the shape of the pre-fix bug: the write error escaped getSession
    // and became the page's error boundary (digest 1420334223).
    await expect(makeServer(unguarded).getSession()).rejects.toThrow(
      /Cookies can only be modified in a Server Action or Route Handler/,
    );
  });

  it('still fails loudly for a non-render cookie error', async () => {
    stubSessionRefresh();
    const failure = new Error('cookie store unavailable');
    const setCookie = createSafeCookieWriter(
      () => {
        throw failure;
      },
      vi.fn(),
    );

    await expect(makeServer(setCookie).getSession()).rejects.toBe(failure);
  });
});
