import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test as setup } from '@playwright/test';
import { E2E_BASE_URL, E2E_ENABLED, E2E_ROSTER_PATH, E2E_SKIP_REASON } from './support/env';

const DEFAULT_PASSWORD = 'Secret1234!';
const ROLES = [
  { role: 'organizer', name: 'E2E Organizer' },
  { role: 'attendee', name: 'E2E Attendee' },
  { role: 'outsider', name: 'E2E Outsider' },
];

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

async function createRole(
  browser: any,
  role: string,
  name: string,
): Promise<{ email: string; password: string; userId: string }> {
  const context = await browser.newContext();
  try {
    const suffix = `${Date.now().toString(36)}${Math.random()
      .toString(36)
      .slice(2, 6)}`;
    const email = `e2e-${role}-${suffix}@example.com`;
    let response = await context.request.post(
      `${E2E_BASE_URL}/api/auth/sign-up/email`,
      {
        headers: {
          'Content-Type': 'application/json',
          Origin: E2E_BASE_URL,
        },
        data: { email, name, password: DEFAULT_PASSWORD },
      },
    );
    for (let attempt = 0; attempt < 2 && response.status() === 429; attempt += 1) {
      const retryAfter = Number(
        response.headers()['x-retry-after'] ?? '10',
      );
      await sleep((Number.isFinite(retryAfter) ? retryAfter : 10) * 1000 + 250);
      response = await context.request.post(
        `${E2E_BASE_URL}/api/auth/sign-up/email`,
        {
          headers: {
            'Content-Type': 'application/json',
            Origin: E2E_BASE_URL,
          },
          data: { email, name, password: DEFAULT_PASSWORD },
        },
      );
    }
    if (!response.ok()) {
      throw new Error(
        `sign-up failed for ${role}: ${response.status()} ${await response.text()}`,
      );
    }
    const sessionResponse = await context.request.get(
      `${E2E_BASE_URL}/api/auth/get-session`,
    );
    if (!sessionResponse.ok()) {
      throw new Error(
        `get-session failed for ${role}: ${sessionResponse.status()}`,
      );
    }
    const session = (await sessionResponse.json()) as {
      user?: { id?: string };
    };
    if (!session.user?.id) {
      throw new Error(`sign-up for ${role} did not establish a session`);
    }
    await context.storageState({
      path: resolve(process.cwd(), 'tests', '.auth', `${role}.json`),
    });
    return { email, password: DEFAULT_PASSWORD, userId: session.user.id };
  } finally {
    await context.close();
  }
}

setup.skip(!E2E_ENABLED, E2E_SKIP_REASON);
setup('create e2e auth roster', async ({ browser }) => {
  mkdirSync(resolve(process.cwd(), 'tests', '.auth'), { recursive: true });
  const roster: Record<string, unknown> = {};
  for (let i = 0; i < ROLES.length; i += 1) {
    const { role, name } = ROLES[i];
    // Space creations out so Better Auth's 3/10s sign-up limit is not hit.
    if (i > 0) await sleep(4_000);
    const created = await createRole(browser, role, name);
    roster[role] = {
      email: created.email,
      password: created.password,
      userId: created.userId,
      cookies: '',
    };
  }
  writeFileSync(E2E_ROSTER_PATH, JSON.stringify(roster, null, 2), 'utf8');
});