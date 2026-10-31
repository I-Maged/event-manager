import { spawnSync } from 'node:child_process';

const command = process.argv.slice(2).join(' ');

if (!command) {
  console.error('Usage: npm run test:branch -- "<command>"');
  process.exit(2);
}

const up = spawnSync('npx', ['tsx', 'scripts/test-db.ts', 'up'], {
  stdio: 'inherit',
  shell: true,
  env: process.env,
});

if (up.status !== 0) {
  process.exit(up.status ?? 1);
}

let status = 0;
try {
  const run = spawnSync(command, { stdio: 'inherit', shell: true, env: process.env });
  status = run.status ?? 1;
} finally {
  spawnSync('npx', ['tsx', 'scripts/test-db.ts', 'down'], {
    stdio: 'inherit',
    shell: true,
    env: process.env,
  });
}

process.exit(status);
