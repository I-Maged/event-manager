import { config } from 'dotenv';
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Load the branch env before any module reads `TEST_BASE_URL`, `DATABASE_URL`,
// or the Neon Auth URLs. `tests/setup/db.ts` loads it again per test file.
config({ path: resolve(process.cwd(), '.env.test'), quiet: true });

/**
 * Vitest global setup for the `http` project.
 *
 * Builds and starts the production app once for the whole run, creates a small
 * roster of real auth users (Better Auth rate-limits sign-up/sign-in, so tests
 * must not sign up per case), then tears everything down. Each test file only
 * makes HTTP requests; it never starts its own server.
 */
export default async function setup(): Promise<() => void> {
  const { assertTestDatabaseSafety } = await import('../support/env');
  assertTestDatabaseSafety();

  const { startApp, stopApp } = await import('./helpers/server');
  await startApp({ build: process.env.HTTP_TEST_SKIP_BUILD !== '1' });

  const { signUp, getSession, exportCookies, clearSession } = await import(
    './helpers/auth'
  );
  const { ROSTER_ROLES, rosterPath } = await import('./helpers/roster');

  const branch = process.env.TEST_DB_BRANCH_ID ?? 'local';
  // The branch can outlive one run (local reuse), so make roster emails unique.
  const runSuffix = `${Date.now().toString(36)}${Math.random()
    .toString(36)
    .slice(2, 8)}`;
  const roster: Record<string, unknown> = {};
  for (const role of ROSTER_ROLES) {
    const email = `${branch}-${runSuffix}-${role}@example.com`;
    const password = 'Secret1234!';
    const result = await signUp(email, password, `HTTP ${role}`);
    if (!result.ok) {
      throw new Error(
        `Failed to create HTTP roster user ${email}: ${result.response.status} ${await result.response.text()}`,
      );
    }
    const session = await getSession();
    if (!session) {
      throw new Error(`Roster user ${email} has no session after sign-up`);
    }
    roster[role] = {
      email,
      password,
      userId: session.userId,
      cookies: exportCookies(),
    };
    clearSession();
  }
  writeFileSync(rosterPath(), JSON.stringify(roster), 'utf8');

  return () => {
    stopApp();
    if (existsSync(rosterPath())) rmSync(rosterPath(), { force: true });
  };
}
