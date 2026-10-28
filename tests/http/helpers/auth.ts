/**
 * Auth helpers for contract tests.
 *
 * Neon Auth (Better Auth) is mounted at `/api/auth`. The relevant endpoints
 * are:
 *   POST /api/auth/sign-up/email   { email, name, password }
 *   POST /api/auth/sign-in/email   { email, password }
 *   POST /api/auth/sign-out        {}
 *   GET  /api/auth/get-session
 *
 * Better Auth validates the browser `Origin` on state-changing calls, so every
 * POST sends `Origin: TEST_BASE_URL`. Sessions are tracked through the cookie
 * jar in `client.ts` (Neon Auth names the cookie
 * `__Secure-neon-auth.session_token`).
 *
 * Sign-up/sign-in are rate-limited to 3 requests per 10 seconds. Tests reuse a
 * roster created once by `global-setup.ts`; `signUp`/`signIn` retry politely
 * when they do hit the limit.
 */

import { readRoster, ROSTER_ROLES, type RosterEntry, type RosterRole } from './roster';
import { uniqueId } from '../../support/factories';
import { baseUrl } from './server';
import {
  clearSession,
  cookieHeader,
  get,
  jsonBody,
  post,
  setCookieHeader,
} from './client';

const API = `${baseUrl}/api/auth`;
const DEFAULT_PASSWORD = 'Secret1234!';

export type AuthResponse = { response: Response; ok: boolean };

export type SessionUser = {
  userId: string;
  email: string;
  name: string;
};

function authHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Origin: baseUrl,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * POST an auth endpoint, waiting out the rate-limiter when it responds 429.
 * `X-Retry-After` is seconds; default to a full 10-second window.
 */
async function postAuth(path: string, body: unknown): Promise<Response> {
  let response = await post(`${API}${path}`, {
    headers: authHeaders(),
    body: jsonBody(body),
  });
  for (let attempt = 0; attempt < 2 && response.status === 429; attempt += 1) {
    const retryAfter = Number(response.headers.get('x-retry-after') ?? '10');
    await sleep((Number.isFinite(retryAfter) ? retryAfter : 10) * 1_000 + 250);
    response = await post(`${API}${path}`, {
      headers: authHeaders(),
      body: jsonBody(body),
    });
  }
  return response;
}

/** Sign up a new user (Neon Auth returns a session immediately). */
export async function signUp(
  email: string,
  password = DEFAULT_PASSWORD,
  name = 'Test User',
): Promise<AuthResponse> {
  const response = await postAuth('/sign-up/email', {
    email,
    name,
    password,
  });
  return { response, ok: response.ok };
}

/** Sign in an existing user. */
export async function signIn(
  email: string,
  password = DEFAULT_PASSWORD,
): Promise<AuthResponse> {
  const response = await postAuth('/sign-in/email', { email, password });
  return { response, ok: response.ok };
}

/** Sign out the current session. */
export async function signOut(): Promise<Response> {
  return post(`${API}/sign-out`, {
    headers: authHeaders(),
    body: jsonBody({}),
  });
}

/** Resolve the signed-in user, or null when there is no valid session. */
export async function getSession(): Promise<SessionUser | null> {
  const response = await get(`${API}/get-session`);
  if (!response.ok) return null;
  try {
    const body = (await response.json()) as {
      user?: { id?: string; email?: string; name?: string };
    };
    if (!body.user?.id) return null;
    return {
      userId: body.user.id,
      email: body.user.email ?? '',
      name: body.user.name ?? '',
    };
  } catch {
    return null;
  }
}

/** True when a response issued a live session cookie. */
export function sessionCookieSet(response: Response): boolean {
  const setCookie = response.headers.getSetCookie?.() ?? [];
  return setCookie.some(
    (cookie) =>
      /(?:^|[.=])session_token=/.test(cookie) && !/Max-Age=0/i.test(cookie),
  );
}

/** Unique email for one test/run. */
export function uniqueEmail(prefix: string): string {
  return `${uniqueId(prefix)}@example.com`;
}

/** Current cookies, for persisting a session across processes. */
export function exportCookies(): string {
  return cookieHeader() ?? '';
}

/** Load a roster user's session without another auth POST. */
export function adoptRosterUser(role: RosterRole): RosterEntry {
  const entry = readRoster()[role];
  if (!entry) throw new Error(`No roster entry for role "${role}"`);
  setCookieHeader(entry.cookies);
  return entry;
}

/** Sign in as a roster user through the real sign-in route. */
export async function signInAsRosterUser(
  role: RosterRole,
): Promise<RosterEntry> {
  const entry = readRoster()[role];
  if (!entry) throw new Error(`No roster entry for role "${role}"`);
  clearSession();
  const result = await signIn(entry.email, entry.password);
  if (!result.ok) {
    throw new Error(
      `sign-in failed for roster user ${entry.email}: ${result.response.status}`,
    );
  }
  return entry;
}

export type TestUser = {
  email: string;
  password: string;
  userId: string;
  session: SessionUser;
};

/** Create a fresh user through the real auth route and return its session. */
export async function createUserAndSignIn(
  prefix = 'user',
  name = 'Test User',
): Promise<TestUser> {
  const email = uniqueEmail(prefix);
  const password = DEFAULT_PASSWORD;
  const signUpResult = await signUp(email, password, name);
  if (!signUpResult.ok) {
    throw new Error(
      `sign-up failed for ${email}: ${signUpResult.response.status} ${await signUpResult.response.text()}`,
    );
  }
  const session = await getSession();
  if (!session) {
    throw new Error(`sign-up for ${email} did not establish a session`);
  }
  return { email, password, userId: session.userId, session };
}

export { DEFAULT_PASSWORD, ROSTER_ROLES, clearSession };
export type { RosterEntry, RosterRole };
