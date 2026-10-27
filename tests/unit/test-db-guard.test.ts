import { describe, expect, it } from 'vitest';
import {
  appDatabaseHosts,
  assertTestDatabaseSafety,
} from '../support/env';

const SAFE_ENV = {
  TEST_DB_ALLOW: '1',
  NODE_ENV: 'test',
  DATABASE_URL:
    'postgresql://user:pass@ep-guard-test-pooler.c-6.eu-central-1.aws.neon.tech/neondb?sslmode=require',
  DATABASE_URL_UNPOOLED:
    'postgresql://user:pass@ep-guard-test.c-6.eu-central-1.aws.neon.tech/neondb?sslmode=require',
} as NodeJS.ProcessEnv;

describe('test database guard', () => {
  it('accepts a pooled/direct Neon branch pair', () => {
    const target = assertTestDatabaseSafety(SAFE_ENV);
    expect(target.endpoint).toBe('ep-guard-test');
    expect(target.pooledHost).toContain('-pooler');
  });

  it('refuses without the explicit opt-in', () => {
    expect(() =>
      assertTestDatabaseSafety({ ...SAFE_ENV, TEST_DB_ALLOW: '' }),
    ).toThrow(/TEST_DB_ALLOW/);
  });

  it('refuses production mode', () => {
    expect(() =>
      assertTestDatabaseSafety({ ...SAFE_ENV, NODE_ENV: 'production' }),
    ).toThrow(/must never run in production/);
  });

  it('refuses a non-pooled application URL', () => {
    expect(() =>
      assertTestDatabaseSafety({
        ...SAFE_ENV,
        DATABASE_URL: SAFE_ENV.DATABASE_URL_UNPOOLED,
      }),
    ).toThrow(/-pooler/);
  });

  it('refuses pooled and direct URLs from different branches', () => {
    expect(() =>
      assertTestDatabaseSafety({
        ...SAFE_ENV,
        DATABASE_URL_UNPOOLED:
          'postgresql://user:pass@ep-other.c-6.eu-central-1.aws.neon.tech/neondb?sslmode=require',
      }),
    ).toThrow(/different branches/);
  });

  it('refuses the app database host from .env', () => {
    const appHost = appDatabaseHosts()[0];
    if (!appHost) return; // no local .env in this checkout
    const pooled = appHost.includes('-pooler') ? appHost : pooledVariant(appHost);
    const direct = appHost.includes('-pooler')
      ? appHost.replace('-pooler', '')
      : appHost;
    expect(() =>
      assertTestDatabaseSafety({
        ...SAFE_ENV,
        DATABASE_URL: `postgresql://user:pass@${pooled}/neondb`,
        DATABASE_URL_UNPOOLED: `postgresql://user:pass@${direct}/neondb`,
      }),
    ).toThrow(/app database/);
  });
});

function pooledVariant(host: string): string {
  const [endpoint, ...rest] = host.split('.');
  return [`${endpoint}-pooler`, ...rest].join('.');
}
