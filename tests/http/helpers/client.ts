/**
 * HTTP client for contract tests with a tiny in-process cookie jar.
 *
 * Node `fetch` has no cookie jar, so we capture `Set-Cookie` headers from
 * responses and forward them as `Cookie` on subsequent requests to the same
 * host. This is enough for session-based auth (Neon Auth sets
 * `__Secure-neon-auth.session_token`).
 */

const cookieJar = new Map<string, string>();

function cookieHeader(): string | null {
  const cookies = [...cookieJar.entries()]
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
  return cookies.length > 0 ? cookies : null;
}

/** Replace the jar with a previously exported `Cookie` header. */
function setCookieHeader(header: string | null): void {
  cookieJar.clear();
  if (!header) return;
  for (const part of header.split(';')) {
    const match = /^\s*([^=]+)=(.*)$/.exec(part);
    if (match) cookieJar.set(match[1], match[2]);
  }
}

function captureCookies(headers: Headers): void {
  const setCookie = headers.getSetCookie?.() ?? [];
  for (const raw of setCookie) {
    const match = /^([^=;]+)=([^;]*)/.exec(raw);
    if (!match) continue;
    const name = match[1];
    const value = match[2];
    const maxAge = /Max-Age=(-?\d+)/i.exec(raw);
    const expired = maxAge !== null && Number(maxAge[1]) <= 0;
    if (expired || value === '') {
      cookieJar.delete(name);
    } else {
      cookieJar.set(name, value);
    }
  }
}

function clearCookie(name?: string): void {
  if (name) {
    cookieJar.delete(name);
  } else {
    cookieJar.clear();
  }
}

/**
 * Fetch wrapper: forwards stored cookies, captures new ones.
 */
export async function request(
  input: string | URL | Request,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers ?? {});
  const cookie = cookieHeader();
  if (cookie) headers.set('Cookie', cookie);

  const res = await fetch(input, { ...init, headers });
  captureCookies(res.headers);
  return res;
}

export async function get(
  input: string | URL,
  init: RequestInit = {},
): Promise<Response> {
  return request(input, { ...init, method: 'GET' });
}

export async function post(
  input: string | URL,
  init: RequestInit = {},
): Promise<Response> {
  return request(input, { ...init, method: 'POST' });
}

export function jsonBody(body: unknown): string {
  return JSON.stringify(body);
}

/** Clear every stored cookie (session tokens and cached session data). */
export function clearSession(): void {
  cookieJar.clear();
}

export { clearCookie, cookieHeader, cookieJar, setCookieHeader };
