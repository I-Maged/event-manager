import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { E2E_ROSTER_PATH } from './env';

export type E2eRosterEntry = {
  email: string;
  password: string;
  userId: string;
  cookies: string;
};

export type E2eRoster = Record<'organizer' | 'attendee' | 'outsider', E2eRosterEntry>;

export function storageStatePath(role: string): string {
  return resolve(process.cwd(), 'tests', '.auth', `${role}.json`);
}

export function readRoster(): E2eRoster {
  return JSON.parse(readFileSync(E2E_ROSTER_PATH, 'utf8')) as E2eRoster;
}

export { test, expect } from '@playwright/test';