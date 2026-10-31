import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { prisma, resetDomainTables } from '../support/db';
import { makeEvent, makeRateLimit, uniqueId } from '../support/factories';

/**
 * Phase 6 / 3.8 — the maintenance CLIs.
 *
 * These run unattended (Neon Function trigger, CI, or an operator's shell), so
 * the contract is the command line: which flag writes, which one only reports,
 * the exit code, and the count it prints. Driving the real script through
 * `tsx` covers that wiring; a test of an extracted core would not.
 *
 * The scripts load `.env` through `dotenv/config`, which never overrides an
 * already-set variable: the branch URLs from `.env.test` win, and the target
 * host is asserted before any write.
 */

const repoRoot = process.cwd();

// `tests/setup/db.ts` already loaded `.env.test` and ran the safety guard for
// this process; reuse that resolved target instead of printing it again.
const pooledUrl = process.env.DATABASE_URL?.trim() ?? '';
const unpooledUrl = process.env.DATABASE_URL_UNPOOLED?.trim() ?? '';
const endpoint = new URL(pooledUrl).host.split('.')[0].replace(/-pooler$/, '');

beforeEach(async () => {
  await resetDomainTables();
});

type ScriptRun = { status: number | null; stdout: string; stderr: string };

function runScript(
  script: string,
  args: string[] = [],
  env: Record<string, string> = {},
): ScriptRun {
  // One command string: Node warns when `shell: true` is combined with an
  // args array, and forward slashes keep the quoted path valid on every shell.
  const scriptPath = resolve(repoRoot, 'scripts', script).replace(/\\/g, '/');
  const command = ['npx', 'tsx', `"${scriptPath}"`, ...args].join(' ');
  const result = spawnSync(command, {
    cwd: repoRoot,
    encoding: 'utf8',
    shell: true,
    timeout: 120_000,
    env: {
      ...process.env,
      // Explicit values always beat the `.env` file the script loads.
      DATABASE_URL: pooledUrl,
      DATABASE_URL_UNPOOLED: unpooledUrl,
      ...env,
    },
  });

  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

/** Both scripts print the resolved host first; never credentials. */
function expectTestTarget(run: ScriptRun): void {
  const output = `${run.stdout}${run.stderr}`;
  expect(output).toContain(endpoint);
  expect(output).not.toContain('postgresql://');
}

describe('rate-limit-cleanup script', () => {
  async function seedStaleAndFresh(): Promise<void> {
    const now = Date.now();
    await makeRateLimit({
      key: `${uniqueId('stale')}`,
      count: 3,
      windowStart: new Date(now - 48 * 60 * 60 * 1000),
    });
    await makeRateLimit({
      key: `${uniqueId('fresh')}`,
      count: 1,
      windowStart: new Date(now - 60_000),
    });
  }

  it('dry run reports the stale count without deleting', async () => {
    await seedStaleAndFresh();

    const run = runScript('rate-limit-cleanup.ts');

    expect(run.status).toBe(0);
    expectTestTarget(run);
    expect(run.stdout).toMatch(/1 RateLimit row\(s\) older than/);
    expect(run.stdout).toContain('dry run');
    expect(await prisma.rateLimit.count()).toBe(2);
  });

  it('--apply deletes the stale rows and reports the count', async () => {
    await seedStaleAndFresh();

    const run = runScript('rate-limit-cleanup.ts', ['--apply']);

    expect(run.status).toBe(0);
    expectTestTarget(run);
    expect(run.stdout).toMatch(/Deleted 1 RateLimit row\(s\)/);
    expect(await prisma.rateLimit.count()).toBe(1);
    const remaining = await prisma.rateLimit.findMany({ select: { count: true } });
    expect(remaining[0]?.count).toBe(1); // the fresh row survived
  });
});

describe('backfill-time-zone script', () => {
  it('dry run reports null-zone rows without writing', async () => {
    const legacy = await makeEvent({ timeZone: null });
    await makeEvent({ timeZone: 'Europe/Berlin' });

    const run = runScript('backfill-time-zone.ts');

    expect(run.status).toBe(0);
    expectTestTarget(run);
    expect(run.stdout).toMatch(/1 event\(s\) have timeZone = null/);
    expect(run.stdout).toContain('Dry run');
    const stored = await prisma.event.findUnique({
      where: { id: legacy.id },
      select: { timeZone: true },
    });
    expect(stored?.timeZone).toBeNull();
  });

  it('--apply --allow-writes stamps only the null rows', async () => {
    const legacy = await makeEvent({ timeZone: null });
    const authored = await makeEvent({ timeZone: 'America/New_York' });

    const run = runScript('backfill-time-zone.ts', [
      '--apply',
      '--allow-writes',
    ]);

    expect(run.status).toBe(0);
    expectTestTarget(run);
    expect(run.stdout).toMatch(/Backfilled 1 event\(s\)/);

    const stamped = await prisma.event.findUnique({
      where: { id: legacy.id },
      select: { timeZone: true },
    });
    expect(stamped?.timeZone).toBe('Europe/Berlin');

    const untouched = await prisma.event.findUnique({
      where: { id: authored.id },
      select: { timeZone: true },
    });
    expect(untouched?.timeZone).toBe('America/New_York');
  });

  it('rejects an invalid APP_TIME_ZONE without writing', async () => {
    const legacy = await makeEvent({ timeZone: null });

    const run = runScript(
      'backfill-time-zone.ts',
      ['--apply', '--allow-writes'],
      { APP_TIME_ZONE: 'Not/AZone' },
    );

    expect(run.status).toBe(1);
    expect(run.stderr).toContain('Not/AZone');
    expect(run.stderr).toContain('not a valid IANA zone');

    const stored = await prisma.event.findUnique({
      where: { id: legacy.id },
      select: { timeZone: true },
    });
    expect(stored?.timeZone).toBeNull();
  });
});
