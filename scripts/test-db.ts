/**
 * Neon branch lifecycle for database-backed tests.
 *
 *   npm run db:test:base    # one-time: create + baseline the data-free base
 *   npm run db:test:up      # create branch, write .env.test, migrate
 *   npm run db:test:down    # delete branch, remove .env.test
 *   npm run db:test:status  # show the current target (hosts only)
 *
 * Requirements (see TESTING.md):
 *   NEON_API_KEY            Neon API key with branch create/delete permission
 *   NEON_PROJECT_ID         project id (or a `.neon` file with `projectId`)
 *
 * Optional:
 *   NEON_TEST_BASE_BRANCH   default `test-base` (data-free base branch)
 *   NEON_TEST_PARENT_BRANCH default `test-base`; never the default branch
 *   NEON_TEST_DATABASE      default `neondb`
 *   NEON_TEST_ROLE          default `neondb_owner`
 *   NEON_API_BASE           override the API host (tests/mocks)
 *
 * `test-base` holds the production DDL and no rows or auth identities.
 * Ephemeral branches are children of it, so they start without any production
 * data. `.env.test` is gitignored and contains credentials; only hosts are ever
 * printed.
 */
import 'dotenv/config';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  existsSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { resolve } from 'node:path';
import { Client } from 'pg';

const API_BASE = process.env.NEON_API_BASE ?? 'https://console.neon.tech/api/v2';
const ENV_TEST_PATH = resolve(process.cwd(), '.env.test');
const DEFAULT_DATABASE = process.env.NEON_TEST_DATABASE ?? 'neondb';
const DEFAULT_ROLE = process.env.NEON_TEST_ROLE ?? 'neondb_owner';
const DEFAULT_BASE_BRANCH = 'test-base';
/**
 * Origin used by Playwright. Neon Auth's `allow_localhost` trusts `localhost`
 * but not `127.0.0.1`, so this must stay on the hostname form.
 */
const TEST_BASE_URL = process.env.TEST_BASE_URL?.trim() || 'http://localhost:3100';
const BRANCH_READY_TIMEOUT_MS = 240_000;
const AUTH_READY_TIMEOUT_MS = 120_000;

type Branch = {
  id: string;
  name: string;
  default?: boolean;
  primary?: boolean;
  current_state?: string;
};

type BranchAuth = {
  base_url?: string;
  jwks_url?: string;
  auth_provider?: string;
};

type DbCounts = {
  public: Array<{ table: string; rows: number }>;
  authUsers: number;
};

function fail(message: string): never {
  console.error(`\n${message}\n`);
  process.exit(1);
}

function sleep(ms: number): Promise<void> {
  return new Promise((done) => setTimeout(done, ms));
}

function apiKey(): string {
  const value = process.env.NEON_API_KEY?.trim();
  if (!value) {
    fail(
      'NEON_API_KEY is required to create/delete test branches. ' +
        'Create a key at https://console.neon.tech/app/settings/api-keys.',
    );
  }
  if (value.startsWith('http')) {
    fail(
      'NEON_API_KEY looks like a URL, not an API key. Create a `napi_...` key ' +
        'at https://console.neon.tech/app/settings/api-keys and put it in `.env`.',
    );
  }
  return value;
}

function projectId(): string {
  const fromEnv = process.env.NEON_PROJECT_ID?.trim();
  if (fromEnv) return fromEnv;

  const dotNeon = resolve(process.cwd(), '.neon');
  if (existsSync(dotNeon)) {
    try {
      const parsed = JSON.parse(readFileSync(dotNeon, 'utf8')) as {
        projectId?: string;
      };
      if (parsed.projectId) return parsed.projectId;
    } catch {
      // fall through to the actionable error below
    }
  }

  fail('NEON_PROJECT_ID is required (or add `projectId` to a `.neon` file).');
}

function headers(): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey()}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
}

async function neonFetch(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { ...headers(), ...(init.headers ?? {}) },
  });
}

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await neonFetch(path, init);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(
      `Neon API ${init.method ?? 'GET'} ${path} failed (${response.status}): ${text.slice(0, 800)}`,
    );
  }
  return (text ? JSON.parse(text) : {}) as T;
}

async function listBranches(pid: string): Promise<Branch[]> {
  const { branches } = await api<{ branches: Branch[] }>(
    `/projects/${pid}/branches`,
  );
  return branches;
}

async function defaultBranchId(pid: string): Promise<string> {
  const { project } = await api<{
    project: { default_branch_id?: string };
  }>(`/projects/${pid}`);
  if (project.default_branch_id) return project.default_branch_id;

  // Some API responses omit `default_branch_id`; the branch list still marks it.
  const branches = await listBranches(pid);
  const fallback =
    branches.find((branch) => branch.default) ??
    branches.find((branch) => branch.primary);
  if (!fallback) fail('Could not resolve the project default branch.');
  return fallback.id;
}

async function waitForBranch(
  pid: string,
  branchId: string,
  label: string,
): Promise<void> {
  const deadline = Date.now() + BRANCH_READY_TIMEOUT_MS;
  let state = 'unknown';
  while (Date.now() < deadline) {
    const { branch } = await api<{ branch: Branch }>(
      `/projects/${pid}/branches/${branchId}`,
    );
    state = branch.current_state ?? 'unknown';
    if (state === 'ready') return;
    await sleep(2_000);
  }
  fail(`Branch "${label}" did not become ready (last state: ${state}).`);
}

async function connectionUri(
  pid: string,
  branchId: string,
  pooled: boolean,
): Promise<string> {
  const query = new URLSearchParams({
    branch_id: branchId,
    database_name: DEFAULT_DATABASE,
    role_name: DEFAULT_ROLE,
    pooled: String(pooled),
  });
  const { uri } = await api<{ uri: string }>(
    `/projects/${pid}/connection_uri?${query.toString()}`,
  );
  return uri;
}

function hostOf(connectionString: string | undefined): string {
  if (!connectionString) return '(unset)';
  try {
    return new URL(connectionString).host;
  } catch {
    return '(unparseable)';
  }
}

function envValue(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/* -------------------------------------------------------------------------- */
/* Database helpers                                                            */
/* -------------------------------------------------------------------------- */

async function withClient<T>(
  connectionString: string,
  run: (client: Client) => Promise<T>,
): Promise<T> {
  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

const AUTH_IDENTITY_TABLES = [
  'user',
  'account',
  'session',
  'invitation',
  'member',
  'organization',
  'verification',
];

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/** Every app table except the Prisma migration history. */
async function publicTables(client: Client): Promise<string[]> {
  const { rows } = await client.query<{ tablename: string }>(
    `select tablename from pg_tables
     where schemaname = 'public' and tablename <> '_prisma_migrations'
     order by tablename`,
  );
  return rows.map((row) => row.tablename);
}

async function countRows(unpooledUrl: string): Promise<DbCounts> {
  return withClient(unpooledUrl, async (client) => {
    const publicRows: DbCounts['public'] = [];
    for (const table of await publicTables(client)) {
      const { rows } = await client.query<{ n: string }>(
        `select count(*)::text as n from public.${quoteIdent(table)}`,
      );
      publicRows.push({ table, rows: Number(rows[0]?.n ?? '0') });
    }

    const { rows: authRows } = await client.query<{ n: string }>(
      `select case
         when to_regclass('neon_auth."user"') is null then '0'
         else (select count(*)::text from neon_auth."user")
       end as n`,
    );

    return { public: publicRows, authUsers: Number(authRows[0]?.n ?? '0') };
  });
}

/**
 * Copy-on-write fallback: remove every row copied from the parent, keeping the
 * schema and the auth configuration (`project_config`, `jwks`) so branch auth
 * stays functional. Identity tables are emptied so no production user can be
 * used to sign in on a test branch.
 */
async function scrubCopiedData(unpooledUrl: string): Promise<void> {
  await withClient(unpooledUrl, async (client) => {
    const tables = await publicTables(client);
    if (tables.length > 0) {
      await client.query(
        `truncate table ${tables
          .map((table) => `public.${quoteIdent(table)}`)
          .join(', ')} restart identity cascade`,
      );
    }

    const { rows } = await client.query<{ name: string }>(
      `select table_name as name from information_schema.tables
       where table_schema = 'neon_auth' and table_name = any($1)`,
      [AUTH_IDENTITY_TABLES],
    );
    const identityTables = rows.map((row) => row.name);
    if (identityTables.length > 0) {
      await client.query(
        `truncate table ${identityTables
          .map((table) => `neon_auth.${quoteIdent(table)}`)
          .join(', ')} restart identity cascade`,
      );
    }
  });
}

async function assertBranchIsPristine(unpooledUrl: string): Promise<void> {
  const counts = await countRows(unpooledUrl);
  const dirty = counts.public.filter((entry) => entry.rows > 0);
  const problems: string[] = [];

  for (const entry of dirty) {
    problems.push(`public."${entry.table}" has ${entry.rows} row(s)`);
  }
  if (counts.authUsers > 0) {
    problems.push(`neon_auth."user" has ${counts.authUsers} row(s)`);
  }
  if (problems.length > 0) {
    fail(
      'Refusing to use this branch: it is not data-free.\n' +
        problems.map((problem) => `  - ${problem}`).join('\n') +
        '\n\nRecreate the base branch with `npm run db:test:base -- --force`.',
    );
  }
}

/* -------------------------------------------------------------------------- */
/* Neon Auth                                                                   */
/* -------------------------------------------------------------------------- */

async function getBranchAuth(
  pid: string,
  branchId: string,
): Promise<BranchAuth | null> {
  const response = await neonFetch(
    `/projects/${pid}/branches/${branchId}/auth`,
  );
  if (response.status === 404) return null;
  const text = await response.text();
  if (!response.ok) {
    throw new Error(
      `Neon API GET auth for ${branchId} failed (${response.status}): ${text.slice(0, 800)}`,
    );
  }
  return (text ? JSON.parse(text) : {}) as BranchAuth;
}

async function createBranchAuth(
  pid: string,
  branchId: string,
): Promise<void> {
  await api(`/projects/${pid}/branches/${branchId}/auth`, {
    method: 'POST',
    body: JSON.stringify({
      auth_provider: 'better_auth',
      database_name: DEFAULT_DATABASE,
    }),
  });
}

async function enableLocalhostAuth(
  pid: string,
  branchId: string,
): Promise<void> {
  await api(`/projects/${pid}/branches/${branchId}/auth/allow_localhost`, {
    method: 'PATCH',
    body: JSON.stringify({ allow_localhost: true }),
  });
}

async function ensureBranchAuth(
  pid: string,
  branchId: string,
  unpooledUrl: string,
): Promise<{ baseUrl: string; jwksUrl: string }> {
  let auth = await getBranchAuth(pid, branchId);

  if (!auth || (!auth.base_url && !auth.auth_provider)) {
    console.log('Provisioning Neon Auth for the test branch...');
    try {
      await createBranchAuth(pid, branchId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('(409)')) {
        // Another request already started provisioning.
      } else if (/neon_auth|already exists/i.test(message)) {
        // The copied branch carries the auth tables but not the integration.
        // This branch is disposable, so clear the half-copied schema and retry.
        console.log(
          'Copied neon_auth schema blocks provisioning; dropping it first...',
        );
        await dropAuthSchema(unpooledUrl);
        await createBranchAuth(pid, branchId);
      } else {
        throw error;
      }
    }
    auth = await getBranchAuth(pid, branchId);
  }

  const deadline = Date.now() + AUTH_READY_TIMEOUT_MS;
  while (!auth?.base_url) {
    if (Date.now() > deadline) {
      fail(
        'Neon Auth did not finish provisioning for the test branch. ' +
          'Check the branch in the Neon Console, then run `npm run db:test:down`.',
      );
    }
    await sleep(2_000);
    auth = await getBranchAuth(pid, branchId);
  }

  return {
    baseUrl: auth.base_url as string,
    jwksUrl: auth.jwks_url ?? '',
  };
}

/* -------------------------------------------------------------------------- */
/* Migrations                                                                  */
/* -------------------------------------------------------------------------- */

function runPrisma(
  args: string[],
  unpooledUrl: string,
  stdio: 'inherit' | 'pipe',
): ReturnType<typeof spawnSync> {
  return spawnSync('npx', ['prisma', ...args], {
    stdio,
    shell: true,
    encoding: 'utf8',
    env: {
      ...process.env,
      DATABASE_URL: unpooledUrl,
      DATABASE_URL_UNPOOLED: unpooledUrl,
    },
  });
}

function migrationNames(): string[] {
  return readdirSync(resolve(process.cwd(), 'prisma', 'migrations'), {
    withFileTypes: true,
  })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

async function appliedMigrationNames(
  unpooledUrl: string,
): Promise<Set<string>> {
  return withClient(unpooledUrl, async (client) => {
    const { rows } = await client.query<{ exists: boolean }>(
      `select to_regclass('public._prisma_migrations') is not null as exists`,
    );
    if (!rows[0]?.exists) return new Set<string>();

    const { rows: applied } = await client.query<{ migration_name: string }>(
      `select migration_name from public._prisma_migrations
       where finished_at is not null and rolled_back_at is null`,
    );
    return new Set(applied.map((row) => row.migration_name));
  });
}

/**
 * The base branch has the production tables but no `_prisma_migrations` rows.
 * Mark every migration as already applied so children start from a clean
 * `prisma migrate deploy` instead of failing on existing tables.
 */
async function baselineMigrations(unpooledUrl: string): Promise<void> {
  const applied = await appliedMigrationNames(unpooledUrl);
  const pending = migrationNames().filter((name) => !applied.has(name));
  if (pending.length === 0) {
    console.log('Migration history is already baselined.');
    return;
  }

  console.log(
    `Marking ${pending.length} migration(s) as applied on the base branch...`,
  );
  for (const name of pending) {
    const result = runPrisma(
      ['migrate', 'resolve', '--applied', name],
      unpooledUrl,
      'pipe',
    );
    if (result.status !== 0) {
      const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
      if (/P3008|already recorded as applied/i.test(output)) continue;
      throw new Error(
        `prisma migrate resolve --applied ${name} failed (exit ${result.status}):\n` +
          output.slice(-1200),
      );
    }
  }
}

function checkMigrations(
  unpooledUrl: string,
  context: string,
  strict: boolean,
): void {
  console.log('\nChecking `prisma migrate status`...');
  const result = runPrisma(['migrate', 'status'], unpooledUrl, 'pipe');
  if (result.status !== 0) {
    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
    if (!strict) {
      console.log(
        'Migrations are not fully applied on this branch. `db:test:up` will ' +
          'apply them to each ephemeral branch.',
      );
      return;
    }
    throw new Error(
      `prisma migrate status is not clean after ${context} (exit ${result.status}):\n` +
        output.slice(-1200),
    );
  }
  console.log('Migrations are up to date.');
}

function runMigrations(pooledUrl: string, unpooledUrl: string): void {
  console.log('\nApplying migrations with `prisma migrate deploy`...');
  const result = spawnSync('npx', ['prisma', 'migrate', 'deploy'], {
    stdio: 'inherit',
    shell: true,
    env: {
      ...process.env,
      DATABASE_URL: pooledUrl,
      DATABASE_URL_UNPOOLED: unpooledUrl,
    },
  });
  if (result.status !== 0) {
    throw new Error(
      `prisma migrate deploy failed (exit ${result.status ?? 'unknown'}).`,
    );
  }
}

/* -------------------------------------------------------------------------- */
/* `.env.test` helpers                                                         */
/* -------------------------------------------------------------------------- */

function existingBranchId(): string | null {
  if (!existsSync(ENV_TEST_PATH)) return null;
  const text = readFileSync(ENV_TEST_PATH, 'utf8');
  const match = /^\s*TEST_DB_BRANCH_ID\s*=\s*"?(.*?)"?\s*$/m.exec(text);
  return match?.[1]?.trim() || null;
}

function readTestEnv(): Record<string, string> {
  if (!existsSync(ENV_TEST_PATH)) return {};
  const result: Record<string, string> = {};
  for (const line of readFileSync(ENV_TEST_PATH, 'utf8').split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!match) continue;
    result[match[1]] = match[2].replace(/^["']|["']$/g, '');
  }
  return result;
}

function writeTestEnvFile(values: Record<string, string>): void {
  const lines = [
    '# Generated by scripts/test-db.ts. Gitignored — contains credentials.',
    '# Delete the branch with `npm run db:test:down`.',
    ...Object.entries(values).map(([key, value]) => `${key}=${envValue(value)}`),
    '',
  ];
  writeFileSync(ENV_TEST_PATH, lines.join('\n'), 'utf8');
}

/* -------------------------------------------------------------------------- */
/* Commands                                                                    */
/* -------------------------------------------------------------------------- */

async function resolveParentBranch(pid: string): Promise<Branch> {
  const ref = process.env.NEON_TEST_PARENT_BRANCH?.trim() || DEFAULT_BASE_BRANCH;
  const branches = await listBranches(pid);
  const match = ref.startsWith('br-')
    ? branches.find((branch) => branch.id === ref)
    : branches.find((branch) => branch.name === ref);

  if (!match) {
    fail(
      `Branch "${ref}" was not found in project ${pid}. ` +
        'Create the data-free base with `npm run db:test:base`.\n' +
        `Available branches: ${branches.map((branch) => branch.name).join(', ')}`,
    );
  }

  const defaultId = await defaultBranchId(pid);
  if (match.id === defaultId) {
    fail(
      `Refusing to create test branches from the default branch "${match.name}". ` +
        `Point NEON_TEST_PARENT_BRANCH at "${DEFAULT_BASE_BRANCH}" (the data-free base).`,
    );
  }

  return match;
}

async function createBaseBranch(
  pid: string,
  production: Branch,
  name: string,
  initSource: string,
): Promise<Branch> {
  const created = await api<{ branch: Branch }>(`/projects/${pid}/branches`, {
    method: 'POST',
    body: JSON.stringify({
      branch: {
        name,
        parent_id: production.id,
        init_source: initSource,
      },
      endpoints: [{ type: 'read_write' }],
    }),
  });
  return created.branch;
}

async function base(): Promise<void> {
  const pid = projectId();
  const name = process.env.NEON_TEST_BASE_BRANCH?.trim() || DEFAULT_BASE_BRANCH;
  const force = process.argv.includes('--force');
  if (force && existsSync(ENV_TEST_PATH)) {
    fail(
      '`.env.test` still points at an ephemeral branch. Run ' +
        '`npm run db:test:down` before recreating the base branch.',
    );
  }
  const branches = await listBranches(pid);
  const defaultId = await defaultBranchId(pid);
  const production = branches.find((branch) => branch.id === defaultId);

  if (!production) fail('Could not resolve the default (production) branch.');
  if (production.name === name) {
    fail(`"${name}" is the default branch; pick a different NEON_TEST_BASE_BRANCH.`);
  }

  let branch = branches.find((candidate) => candidate.name === name);
  let createdNow = false;
  let copiedData = false;

  if (branch && force) {
    console.log(`Deleting existing base branch ${branch.id} (--force)...`);
    await deleteBranch(pid, branch.id);
    branch = undefined;
  }

  if (branch) {
    console.log(`Base branch "${name}" already exists (${branch.id}).`);
  } else {
    const requested = process.env.NEON_TEST_INIT_SOURCE?.trim() || 'schema-only';
    console.log(
      `Creating base branch "${name}" from "${production.name}" (init_source: ${requested})...`,
    );
    try {
      branch = await createBaseBranch(pid, production, name, requested);
      createdNow = true;
      copiedData = requested === 'parent-data';
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Neon Auth's legacy web access roles (`anonymous`, `authenticated`)
      // block every schema-only init source. Rather than mutate production,
      // make a one-time copy-on-write branch and scrub it immediately.
      if (requested !== 'parent-data' && /legacy web access role/i.test(message)) {
        console.log(
          'Schema-only branches are unavailable for this project (legacy web ' +
            'access role). Falling back to a one-time copy-on-write branch; ' +
            'rows are removed and verified before any test can use it.',
        );
        branch = await createBaseBranch(pid, production, name, 'parent-data');
        createdNow = true;
        copiedData = true;
      } else {
        throw error;
      }
    }
  }

  try {
    await waitForBranch(pid, branch.id, name);
    const unpooledUrl = await connectionUri(pid, branch.id, false);
    console.log(`  ${name} direct -> ${hostOf(unpooledUrl)}`);

    if (copiedData) {
      console.log(
        'Scrubbing copied rows (app tables + auth identities; auth config kept)...',
      );
      await scrubCopiedData(unpooledUrl);
    }

    await baselineMigrations(unpooledUrl);
    checkMigrations(unpooledUrl, 'baselining', false);
    await assertBranchIsPristine(unpooledUrl);

    const auth = await getBranchAuth(pid, branch.id);
    console.log(
      auth?.base_url
        ? `Neon Auth is already enabled on the base branch -> ${hostOf(auth.base_url)}`
        : 'Neon Auth is not enabled on the base branch; `db:test:up` provisions it per run.',
    );
  } catch (error) {
    if (createdNow) {
      console.error(
        '\nBase setup failed; deleting the branch so no copied rows are left behind...',
      );
      try {
        await deleteBranch(pid, branch.id);
      } catch (cleanupError) {
        console.error('Cleanup also failed:', cleanupError);
      }
    }
    throw error;
  }

  console.log('\nData-free base branch is ready.');
  console.log(`  NEON_TEST_PARENT_BRANCH="${name}"`);
  console.log('Next: `npm run db:test:up`.');
}

async function dropAuthSchema(unpooledUrl: string): Promise<boolean> {
  return withClient(unpooledUrl, async (client) => {
    const { rows } = await client.query<{ exists: boolean }>(
      `select exists (
         select 1 from information_schema.schemata where schema_name = 'neon_auth'
       ) as exists`,
    );
    if (!rows[0]?.exists) return false;
    await client.query('drop schema neon_auth cascade');
    return true;
  });
}

async function up(): Promise<void> {
  const pid = projectId();
  const force = process.argv.includes('--force');
  const current = existingBranchId();
  if (current && !force) {
    fail(
      `.env.test already points at branch ${current}. Run \`npm run db:test:down\` ` +
        'first, or pass `--force` to replace it.',
    );
  }
  if (current && force) {
    console.log(`Deleting existing test branch ${current} (--force)...`);
    await deleteBranch(pid, current);
  }

  const parent = await resolveParentBranch(pid);
  const name = `test-${new Date()
    .toISOString()
    .replace(/[:.]/g, '-')}-${Math.random().toString(36).slice(2, 8)}`;

  console.log(`Creating branch "${name}" from parent ${parent.name}...`);
  const created = await api<{ branch: Branch }>(`/projects/${pid}/branches`, {
    method: 'POST',
    body: JSON.stringify({
      branch: { name, parent_id: parent.id },
      endpoints: [{ type: 'read_write' }],
    }),
  });
  const branchId = created.branch.id;

  if (branchId === parent.id) {
    fail('Refusing to reuse the parent branch as the test branch.');
  }

  try {
    await waitForBranch(pid, branchId, name);

    const pooledUrl = await connectionUri(pid, branchId, true);
    const unpooledUrl = await connectionUri(pid, branchId, false);
    const auth = await ensureBranchAuth(pid, branchId, unpooledUrl);
    // Browser auth flows proxy the browser `Origin` upstream, so the branch
    // must trust the Playwright origin before any auth test can run.
    await enableLocalhostAuth(pid, branchId);

    writeTestEnvFile({
      TEST_DB_ALLOW: '1',
      DATABASE_URL: pooledUrl,
      DATABASE_URL_UNPOOLED: unpooledUrl,
      APP_TIME_ZONE: 'Europe/Berlin',
      TEST_BASE_URL: TEST_BASE_URL,
      NEON_AUTH_BASE_URL: auth.baseUrl,
      NEON_AUTH_JWKS_URL: auth.jwksUrl,
      // Per-run secret: test sessions can never be replayed against production.
      NEON_AUTH_COOKIE_SECRET: randomBytes(32).toString('base64url'),
      TEST_DB_PROJECT_ID: pid,
      TEST_DB_BRANCH_ID: branchId,
      TEST_DB_BRANCH_NAME: name,
      TEST_DB_AUTH_HOST: hostOf(auth.baseUrl),
    });

    console.log('\nWrote .env.test');
    console.log(`  DATABASE_URL          -> ${hostOf(pooledUrl)}`);
    console.log(`  DATABASE_URL_UNPOOLED -> ${hostOf(unpooledUrl)}`);
    console.log(`  NEON_AUTH_BASE_URL    -> ${hostOf(auth.baseUrl)}`);
    console.log(`  branch                -> ${branchId}`);

    runMigrations(pooledUrl, unpooledUrl);
    checkMigrations(unpooledUrl, 'migrate deploy', true);
    await assertBranchIsPristine(unpooledUrl);
  } catch (error) {
    console.error('\nSetup failed; deleting the half-initialized branch...');
    try {
      await deleteBranch(pid, branchId);
      rmSync(ENV_TEST_PATH, { force: true });
    } catch (cleanupError) {
      console.error('Cleanup also failed:', cleanupError);
    }
    throw error;
  }

  console.log('\nTest branch ready. Run `npm run test:db` or `npm run test:e2e`.');
}

async function deleteBranch(pid: string, branchId: string): Promise<boolean> {
  const response = await neonFetch(`/projects/${pid}/branches/${branchId}`, {
    method: 'DELETE',
  });
  if (response.status === 404) return false;
  if (!response.ok) {
    throw new Error(
      `Neon API DELETE branch ${branchId} failed (${response.status}): ` +
        (await response.text()).slice(0, 800),
    );
  }
  return true;
}

async function down(): Promise<void> {
  const env = readTestEnv();
  const pid =
    env.TEST_DB_PROJECT_ID?.trim() ||
    process.env.NEON_PROJECT_ID?.trim() ||
    '';
  const branchId =
    env.TEST_DB_BRANCH_ID?.trim() || process.env.TEST_DB_BRANCH_ID?.trim() || '';

  if (!branchId) {
    console.log('No TEST_DB_BRANCH_ID in .env.test; nothing to delete.');
    rmSync(ENV_TEST_PATH, { force: true });
    return;
  }
  if (!pid) {
    fail('Cannot delete the test branch without a project id.');
  }

  console.log(`Deleting test branch ${branchId}...`);
  const deleted = await deleteBranch(pid, branchId);
  if (!deleted) console.log('Branch was already gone.');
  rmSync(ENV_TEST_PATH, { force: true });
  console.log('Removed .env.test.');
}

function status(): void {
  const env = readTestEnv();
  if (Object.keys(env).length === 0) {
    console.log('No .env.test found. Run `npm run db:test:up` to create one.');
    return;
  }
  console.log('Test database target (hosts only):');
  console.log(`  DATABASE_URL          -> ${hostOf(env.DATABASE_URL)}`);
  console.log(`  DATABASE_URL_UNPOOLED -> ${hostOf(env.DATABASE_URL_UNPOOLED)}`);
  console.log(
    `  NEON_AUTH_BASE_URL    -> ${hostOf(env.NEON_AUTH_BASE_URL)}`,
  );
  console.log(`  project               -> ${env.TEST_DB_PROJECT_ID ?? '(unset)'}`);
  console.log(`  branch                -> ${env.TEST_DB_BRANCH_ID ?? '(unset)'}`);
  console.log(
    `  branch name           -> ${env.TEST_DB_BRANCH_NAME ?? '(unset)'}`,
  );
}

async function main(): Promise<void> {
  const command = process.argv[2];
  switch (command) {
    case 'base':
      await base();
      break;
    case 'up':
      await up();
      break;
    case 'down':
      await down();
      break;
    case 'status':
      status();
      break;
    default:
      fail(
        'Usage: tsx scripts/test-db.ts <base|up|down|status> [--force]',
      );
  }
}

main().catch((error: unknown) => {
  console.error(
    'test-db failed:',
    error instanceof Error ? (error.stack ?? error.message) : error,
  );
  process.exitCode = 1;
});
