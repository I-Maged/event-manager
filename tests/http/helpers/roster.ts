/**
 * Shared auth roster for HTTP contract tests.
 *
 * Better Auth rate-limits `/sign-up` and `/sign-in` to 3 requests per 10 seconds,
 * so creating a fresh user per test is not viable. `global-setup.ts` creates a
 * small roster once, stores each user's session cookies, and each test file
 * reuses those cookies without another auth POST.
 */

import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const ROSTER_ROLES = ['organizer', 'holder', 'outsider', 'other'] as const;
export type RosterRole = (typeof ROSTER_ROLES)[number];

export type RosterEntry = {
  email: string;
  password: string;
  userId: string;
  cookies: string;
};

export type Roster = Record<RosterRole, RosterEntry>;

export function rosterPath(): string {
  const branch = process.env.TEST_DB_BRANCH_ID ?? 'local';
  return join(tmpdir(), `event-manager-http-roster-${branch}.json`);
}

export function readRoster(): Roster {
  return JSON.parse(readFileSync(rosterPath(), 'utf8')) as Roster;
}
