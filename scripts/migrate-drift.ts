import { config } from 'dotenv';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

async function main(): Promise<void> {
  config({ path: resolve(process.cwd(), '.env.test'), quiet: true });

  const { assertTestDatabaseSafety } = await import('../tests/support/env');
  assertTestDatabaseSafety();

  const result = spawnSync(
    'npx',
    [
      'prisma',
      'migrate',
      'diff',
      '--from-config-datasource',
      '--to-schema',
      'prisma/schema.prisma',
      '--exit-code',
    ],
    { stdio: 'inherit', shell: true, env: process.env },
  );

  process.exitCode = result.status ?? 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
