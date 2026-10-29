import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { E2E_ROSTER_PATH } from './env';
import type { Roster } from '../../http/helpers/roster';

export function storageStatePath(role: string): string {
  return resolve(process.cwd(), 'tests', '.auth', `${role}.json`);
}

export function readRoster(): Roster {
  return JSON.parse(readFileSync(E2E_ROSTER_PATH, 'utf8')) as Roster;
}

export { test, expect } from '@playwright/test';