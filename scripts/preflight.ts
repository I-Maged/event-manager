/**
 * Preflight for the destructive dev probes (`rsvp-concurrency.ts`,
 * `rate-limit-check.ts`, `backfill-time-zone.ts --apply`).
 *
 * Those scripts insert and delete rows. They must never run by accident
 * against a primary/production branch, so each one calls
 * `requireProbeTarget()` first: it prints the resolved database hosts and
 * refuses to continue unless writes were explicitly allowed.
 *
 *   npx tsx scripts/rsvp-concurrency.ts --allow-writes
 *   PROBE_ALLOW=1 npx tsx scripts/rsvp-concurrency.ts
 *
 * The flag is cross-platform (works in cmd/PowerShell and POSIX shells);
 * `PROBE_ALLOW=1` is kept for the form the original plan documented.
 * Credentials are never printed — only the host.
 */
import 'dotenv/config';

function hostOf(connectionString: string | undefined): string {
  if (!connectionString) return '(unset)';
  try {
    return new URL(connectionString).host;
  } catch {
    return '(unparseable)';
  }
}

/** Human-readable target summary (hosts only, never credentials). */
export function describeDatabaseTarget(): string {
  return [
    `DATABASE_URL          -> ${hostOf(process.env.DATABASE_URL)}`,
    `DATABASE_URL_UNPOOLED -> ${hostOf(process.env.DATABASE_URL_UNPOOLED)}`,
  ].join('\n');
}

/**
 * Prints the target and exits 1 unless probe writes are explicitly enabled.
 * Call this as the first statement of a probe's `main()`.
 */
export function requireProbeTarget(script: string): void {
  const allowed =
    process.argv.includes('--allow-writes') || process.env.PROBE_ALLOW === '1';

  console.log(`${script} database target:\n${describeDatabaseTarget()}`);

  if (!allowed) {
    console.error(
      '\nRefusing to write. Re-run with --allow-writes (or PROBE_ALLOW=1) ' +
        'after confirming the host above is a dev branch.',
    );
    process.exit(1);
  }

  console.log('\n--allow-writes confirmed: probe writes are enabled.\n');
}
