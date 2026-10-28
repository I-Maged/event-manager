import { beforeEach, describe, expect, it } from 'vitest';
import { baseUrl } from './helpers/server';
import { request } from './helpers/client';
import {
  clearSession,
  getSession,
  sessionCookieSet,
  signIn,
  signOut,
  signUp,
  uniqueEmail,
  adoptRosterUser,
} from './helpers/auth';
import { readRoster } from './helpers/roster';
import { resetDomainTables } from '../support/db';

beforeEach(async () => {
  clearSession();
  await resetDomainTables();
});

describe('Auth routes (4.3)', () => {
  it('sign-up succeeds with valid input and establishes a session', async () => {
    const email = uniqueEmail('signup');
    const res = await signUp(email, 'Secret1234!', 'Test User');
    expect(res.ok).toBe(true);
    expect(sessionCookieSet(res.response)).toBe(true);

    const session = await getSession();
    expect(session?.email).toBe(email);
  });

  it('sign-up rejects invalid input without a session cookie', async () => {
    const existing = readRoster().other;

    const missingEmail = await signUp('', 'Secret1234!', 'No Email');
    expect(missingEmail.ok).toBe(false);
    expect(sessionCookieSet(missingEmail.response)).toBe(false);

    const shortPassword = await signUp(
      uniqueEmail('shortpass'),
      'short',
      'Short Pass',
    );
    expect(shortPassword.ok).toBe(false);
    expect(sessionCookieSet(shortPassword.response)).toBe(false);

    const duplicate = await signUp(
      existing.email,
      existing.password,
      'Duplicate',
    );
    expect(duplicate.ok).toBe(false);
    expect(sessionCookieSet(duplicate.response)).toBe(false);
  });

  it('sign-in succeeds and sets a session cookie', async () => {
    const roster = readRoster().organizer;
    clearSession();

    const res = await signIn(roster.email, roster.password);
    expect(res.ok).toBe(true);
    expect(sessionCookieSet(res.response)).toBe(true);
    expect((await getSession())?.email).toBe(roster.email);
  });

  it('sign-in with a bad password fails without a session cookie', async () => {
    const roster = readRoster().organizer;
    clearSession();

    const res = await signIn(roster.email, 'WrongPassword1!');
    expect(res.ok).toBe(false);
    expect(sessionCookieSet(res.response)).toBe(false);
    expect(await getSession()).toBeNull();
  });

  it('sign-out clears the session', async () => {
    adoptRosterUser('organizer');
    expect(await getSession()).not.toBeNull();

    const res = await signOut();
    expect(res.ok).toBe(true);
    expect(await getSession()).toBeNull();
  });

  it('protected routes redirect signed-out users to sign-in', async () => {
    for (const route of ['/my-events', '/wishlist', '/notifications']) {
      const res = await request(`${baseUrl}${route}`, { redirect: 'manual' });
      expect(res.status, route).toBe(307);
      expect(res.headers.get('Location'), route).toContain('/auth/sign-in');
    }
  });

  it('signed-in users can access protected routes', async () => {
    adoptRosterUser('organizer');
    for (const route of ['/my-events', '/wishlist', '/notifications']) {
      const res = await request(`${baseUrl}${route}`, { redirect: 'manual' });
      expect(res.status, route).toBe(200);
    }
  });
});
