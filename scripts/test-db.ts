/**
 * Ephemeral Neon branch lifecycle for database-backed tests.
 *
 *   npm run db:test:up      # create branch, write .env.test, migrate deploy
 *   npm run db:test:down    # delete branch, remove .env.test
 *   npm run db:test:status  # show the current target (hosts only)
 *
 * Requirements (see TESTING.md):
 *   NEON_API_KEY            Neon API key with branch create/delete permission
 *   NEON_PROJECT_ID         project id (or a `.neon` file with `projectId`)
 *   NEON_TEST_PARENT_BRANCH schema-only parent branch (id or name)
 *
 * Optional:
 *   NEON_TEST_DATABASE      default `neondb`
 *   NEON_TEST_ROLE          default `neondb_owner`
 *   NEON_API_BASE           override the API host (tests/mocks)
 *
 * The branch is created from the parent, never from production. `.env.test` is
 * gitignored and contains credentials; only hosts are ever printed.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const API_BASE = process.env.NEON_API_BASE ?? 'https://console.neon.tech/api/v2';
const ENV_TEST_PATH = resolve(process.cwd(), '.env.test');
const DEFAULT_DATABASE = process.env.NEON_TEST_DATABASE ?? 'neondb';
const DEFAULT_ROLE = process.env.NEON_TEST_ROLE ?? 'neondb_owner';

type Branch = { id: string; name: string };

function fail(message: string): never {
  console.error(`\n${message}\n`);
  process.exit(1);
}

function apiKey(): string {
  const value = process.env.NEON_API_KEY?.trim();
  if (!value) {
    fail(
      'NEON_API_KEY is required to create/delete test branches. ' +
        'Create a key at https://console.neon.tech/app/settings/api-keys.',
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

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { ...headers(), ...(init.headers ?? {}) },
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(
      `Neon API ${init.method ?? 'GET'} ${path} failed (${response.status}): ${text.slice(0, 800)}`,
    );
  }
  return (text ? JSON.parse(text) : {}) as T;
}

async function resolveParentBranchId(pid: string): Promise<string> {
  const ref = process.env.NEON_TEST_PARENT_BRANCH?.trim();
  if (!ref) {
    fail(
      'NEON_TEST_PARENT_BRANCH is required. It must name a schema-only branch ' +
        '(for example `test-base`), never the production branch.',
    );
  }
  if (ref.startsWith('br-')) return ref;

  const { branches } = await api<{ branches: Branch[] }>(
    `/projects/${pid}/branches`,
  );
  const match = branches.find((branch) => branch.name === ref);
  if (!match) {
    fail(
      `Branch "${ref}" was not found in project ${pid}. Available branches: ` +
        branches.map((branch) => branch.name).join(', '),
    );
  }
  return match.id;
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

async function deleteBranch(pid: string, branchId: string): Promise<boolean> {
  const response = await fetch(
    `${API_BASE}/projects/${pid}/branches/${branchId}`,
    { method: 'DELETE', headers: headers() },
  );
  if (response.status === 404) return false;
  if (!response.ok) {
    throw new Error(
      `Neon API DELETE branch ${branchId} failed (${response.status}): ` +
        (await response.text()).slice(0, 800),
    );
  }
  return true;
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

  const parentId = await resolveParentBranchId(pid);
  const name = `test-${new Date()
    .toISOString()
    .replace(/[:.]/g, '-')}-${Math.random().toString(36).slice(2, 8)}`;

  console.log(`Creating branch "${name}" from parent ${parentId}...`);
  const created = await api<{ branch: Branch }>(
    `/projects/${pid}/branches`,
    {
      method: 'POST',
      body: JSON.stringify({
        branch: { name, parent_id: parentId },
        endpoints: [{ type: 'read_write' }],
      }),
    },
  );
  const branchId = created.branch.id;

  try {
    const pooledUrl = await connectionUri(pid, branchId, true);
    const unpooledUrl = await connectionUri(pid, branchId, false);

    const envFile = [
      '# Generated by scripts/test-db.ts. Gitignored — contains credentials.',
      '# Delete the branch with `npm run db:test:down`.',
      'TEST_DB_ALLOW=1',
      `DATABASE_URL=${envValue(pooledUrl)}`,
      `DATABASE_URL_UNPOOLED=${envValue(unpooledUrl)}`,
      'APP_TIME_ZONE="Europe/Berlin"',
      `TEST_DB_PROJECT_ID=${envValue(pid)}`,
      `TEST_DB_BRANCH_ID=${envValue(branchId)}`,
      `TEST_DB_BRANCH_NAME=${envValue(name)}`,
      '',
    ].join('\n');
    writeFileSync(ENV_TEST_PATH, envFile, 'utf8');

    console.log(`Wrote .env.test\n`);
    console.log(`  DATABASE_URL          -> ${hostOf(pooledUrl)}`);
    console.log(`  DATABASE_URL_UNPOOLED -> ${hostOf(unpooledUrl)}`);
    console.log(`  branch                -> ${branchId}`);

    runMigrations(pooledUrl, unpooledUrl);
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

async function down(): Promise<void> {
  const env = readTestEnv();
  const pid =
    env.TEST_DB_PROJECT_ID?.trim() ||
    process.env.NEON_PROJECT_ID?.trim() ||
    '';
  const branchId = env.TEST_DB_BRANCH_ID?.trim() || process.env.TEST_DB_BRANCH_ID?.trim() || '';

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
  console.log(`  project               -> ${env.TEST_DB_PROJECT_ID ?? '(unset)'}`);
  console.log(`  branch                -> ${env.TEST_DB_BRANCH_ID ?? '(unset)'}`);
  console.log(`  branch name           -> ${env.TEST_DB_BRANCH_NAME ?? '(unset)'}`);
}

async function main(): Promise<void> {
  const command = process.argv[2];
  switch (command) {
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
      fail('Usage: tsx scripts/test-db.ts <up|down|status> [--force]');
  }
}

main().catch((error: unknown) => {
  console.error(
    'test-db failed:',
    error instanceof Error ? (error.stack ?? error.message) : error,
  );
  process.exitCode = 1;
});
