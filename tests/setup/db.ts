import { config } from 'dotenv';
import { resolve } from 'node:path';
import { afterAll } from 'vitest';
import { assertTestDatabaseSafety } from '../support/env';

// Load ONLY the test env. Loading `.env` here would point the guard (and the
// Prisma client) at the app database when no branch has been created.
config({ path: resolve(process.cwd(), '.env.test'), quiet: true });

// Throws before any test file executes when the target is not a safe branch.
assertTestDatabaseSafety();

afterAll(async () => {
  const { prisma } = await import('@/db');
  await prisma.$disconnect();
});
