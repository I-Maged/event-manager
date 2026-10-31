import { describe, expect, it, vi } from 'vitest';
import {
  createSafeCookieWriter,
  isCookiesReadOnlyError,
} from '@/lib/auth/cookie-write';

/**
 * F1 — a session-cookie refresh must never turn an RSC render into the error
 * boundary. These tests pin the guarded writer's contract; the SDK-level
 * regression test (`auth-session-render.test.ts`) proves it against the real
 * Neon Auth server path.
 */

const RENDER_ERROR = new Error(
  'Cookies can only be modified in a Server Action or Route Handler. ' +
    'Read more: https://nextjs.org/docs/app/api-reference/functions/cookies#options',
);

describe('isCookiesReadOnlyError', () => {
  it('recognizes Next 16 render-time cookie rejection', () => {
    expect(isCookiesReadOnlyError(RENDER_ERROR)).toBe(true);
    expect(isCookiesReadOnlyError(RENDER_ERROR.message)).toBe(true);
  });

  it('does not match unrelated failures', () => {
    expect(isCookiesReadOnlyError(new Error('disk full'))).toBe(false);
    expect(isCookiesReadOnlyError(null)).toBe(false);
    expect(isCookiesReadOnlyError({ digest: 'X' })).toBe(false);
  });
});

describe('createSafeCookieWriter', () => {
  it('skips a render-time write instead of throwing, and reports it', async () => {
    const skipped: { name: string; error: Error }[] = [];
    const write = vi.fn(() => {
      throw RENDER_ERROR;
    });
    const setCookie = createSafeCookieWriter(write, (name, error) => {
      skipped.push({ name, error });
    });

    await expect(
      setCookie('__Secure-neon-auth.local.session_data', 'value', {
        path: '/',
        httpOnly: true,
      }),
    ).resolves.toBeUndefined();

    expect(write).toHaveBeenCalledTimes(1);
    expect(skipped).toEqual([
      {
        name: '__Secure-neon-auth.local.session_data',
        error: RENDER_ERROR,
      },
    ]);
  });

  it('passes a write through unchanged where cookies are writable', async () => {
    const write = vi.fn();
    const onSkipped = vi.fn();
    const setCookie = createSafeCookieWriter(write, onSkipped);

    await setCookie('cookie', 'v', { path: '/', maxAge: 60 });

    expect(write).toHaveBeenCalledWith('cookie', 'v', {
      path: '/',
      maxAge: 60,
    });
    expect(onSkipped).not.toHaveBeenCalled();
  });

  it('still surfaces unrelated cookie failures', async () => {
    const failure = new Error('store unavailable');
    const setCookie = createSafeCookieWriter(
      () => {
        throw failure;
      },
      vi.fn(),
    );

    await expect(setCookie('cookie', 'v', {})).rejects.toBe(failure);
  });
});
