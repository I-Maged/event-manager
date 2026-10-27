import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Safety guard for every database-backed test run.
 *
 * The integration, HTTP, and E2E layers write and truncate real rows. They are
 * only allowed to touch an ephemeral Neon branch created by
 * `npm run db:test:up`, so this module refuses to continue unless:
 *
 *   - `TEST_DB_ALLOW=1` is set explicitly,
 *   - both URLs are present and parse,
 *   - the pooled URL really is a `-pooler` host,
 *   - pooled and unpooled URLs resolve to the same Neon endpoint/branch,
 *   - neither host equals the app database host in `.env` (the production /
 *     development branch).
 *
 * Only hosts are ever printed. Credentials stay in `.env.test`.
 */

export type TestDbTarget = {
  pooledUrl: string;
  unpooledUrl: string;
  pooledHost: string;
  unpooledHost: string;
  endpoint: string;
};

function hostOf(connectionString: string): string {
  return new URL(connectionString).host;
}

/** Neon endpoint id from a host (`ep-x-pooler.c-6…` -> `ep-x`). */
function endpointOf(host: string): string {
  return host.split('.')[0].replace(/-pooler$/, '');
}

function readEnvFileVar(file: string, name: string): string | null {
  if (!existsSync(file)) return null;
  const text = readFileSync(file, 'utf8');
  const match = new RegExp(`^\\s*${name}\\s*=\\s*(.*)$`, 'm').exec(text);
  if (!match) return null;
  const value = match[1].trim().replace(/^["']|["']$/g, '');
  return value.length > 0 ? value : null;
}

/** Hosts declared in the repo's `.env` (the app / production branch). */
export function appDatabaseHosts(): string[] {
  const envPath = resolve(process.cwd(), '.env');
  const hosts: string[] = [];
  for (const name of ['DATABASE_URL', 'DATABASE_URL_UNPOOLED']) {
    const raw = readEnvFileVar(envPath, name);
    if (!raw) continue;
    try {
      hosts.push(hostOf(raw));
    } catch {
      // Unparseable app env is not this guard's problem.
    }
  }
  return hosts;
}

export function describeTestDatabaseTarget(target: TestDbTarget): string {
  return [
    `DATABASE_URL          -> ${target.pooledHost}`,
    `DATABASE_URL_UNPOOLED -> ${target.unpooledHost}`,
    `endpoint              -> ${target.endpoint}`,
  ].join('\n');
}

/**
 * Validates the current process env and returns the resolved target.
 * Throws with every problem listed, so a misconfigured run fails loudly
 * instead of silently writing to the wrong branch.
 */
export function assertTestDatabaseSafety(
  env: NodeJS.ProcessEnv = process.env,
): TestDbTarget {
  const problems: string[] = [];

  if (env.TEST_DB_ALLOW !== '1') {
    problems.push(
      'TEST_DB_ALLOW is not "1" — refusing to run destructive DB tests.',
    );
  }
  if (env.NODE_ENV === 'production') {
    problems.push('NODE_ENV=production — tests must never run in production mode.');
  }

  const pooledUrl = env.DATABASE_URL?.trim() ?? '';
  const unpooledUrl = env.DATABASE_URL_UNPOOLED?.trim() ?? '';
  if (!pooledUrl) problems.push('DATABASE_URL is not set.');
  if (!unpooledUrl) problems.push('DATABASE_URL_UNPOOLED is not set.');

  let pooledHost = '';
  let unpooledHost = '';
  if (pooledUrl && unpooledUrl) {
    try {
      pooledHost = hostOf(pooledUrl);
      unpooledHost = hostOf(unpooledUrl);
    } catch {
      problems.push('DATABASE_URL or DATABASE_URL_UNPOOLED is not a valid URL.');
    }
  }

  if (pooledHost && unpooledHost) {
    if (!pooledHost.includes('-pooler')) {
      problems.push(
        `DATABASE_URL host "${pooledHost}" is not a Neon pooled (-pooler) host.`,
      );
    }
    if (pooledHost === unpooledHost) {
      problems.push(
        'DATABASE_URL and DATABASE_URL_UNPOOLED resolve to the same host; ' +
          'the migration URL must be the direct one.',
      );
    }
    if (endpointOf(pooledHost) !== endpointOf(unpooledHost)) {
      problems.push(
        `pooled (${endpointOf(pooledHost)}) and unpooled (${endpointOf(unpooledHost)}) ` +
          'URLs point at different branches.',
      );
    }

    for (const appHost of appDatabaseHosts()) {
      if (
        appHost === pooledHost ||
        appHost === unpooledHost ||
        endpointOf(appHost) === endpointOf(pooledHost)
      ) {
        problems.push(
          `refusing to target the app database from .env (${appHost}). ` +
            'Create an ephemeral branch with `npm run db:test:up`.',
        );
        break;
      }
    }

    const allowlist = (env.TEST_DB_HOST_ALLOWLIST ?? '')
      .split(',')
      .map((suffix) => suffix.trim())
      .filter(Boolean);
    if (
      allowlist.length > 0 &&
      !allowlist.some((suffix) => pooledHost.endsWith(suffix))
    ) {
      problems.push(
        `DATABASE_URL host does not match TEST_DB_HOST_ALLOWLIST (${allowlist.join(', ')}).`,
      );
    }
  }

  if (problems.length > 0) {
    throw new Error(
      [
        'Refusing to run database-backed tests:',
        ...problems.map((problem) => `  - ${problem}`),
        '',
        'Set up an ephemeral branch with `npm run db:test:up` (see TESTING.md).',
      ].join('\n'),
    );
  }

  const target: TestDbTarget = {
    pooledUrl,
    unpooledUrl,
    pooledHost,
    unpooledHost,
    endpoint: endpointOf(pooledHost),
  };

  // Hosts only — never credentials.
  console.log(`[test-db] target:\n${describeTestDatabaseTarget(target)}`);
  return target;
}
