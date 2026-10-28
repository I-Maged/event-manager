import react from '@vitejs/plugin-react';
import tsconfigPaths from 'vite-tsconfig-paths';
import { defineConfig } from 'vitest/config';

/**
 * Four projects so each layer gets its own environment and can run alone:
 *
 *   npm test              -> unit + components (no DB, no network)
 *   npm test:db           -> db (serial, ephemeral Neon branch via .env.test)
 *   npm test:http         -> http (built app + test branch)
 *
 * The `db` project is serial because it truncates domain tables between tests
 * and drives concurrency scenarios that must not interleave with each other.
 */
export default defineConfig({
  plugins: [tsconfigPaths(), react()],
  test: {
    // The http project lands in Phase 4; until then `npm run test:http` is a
    // clean no-op instead of a "no test files" failure.
    passWithNoTests: true,
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          environment: 'node',
          include: ['tests/unit/**/*.test.ts'],
          setupFiles: ['tests/setup/unit.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'components',
          environment: 'jsdom',
          include: ['tests/components/**/*.test.tsx'],
          setupFiles: ['tests/setup/components.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'db',
          environment: 'node',
          include: ['tests/db/**/*.test.ts'],
          setupFiles: ['tests/setup/db.ts'],
          fileParallelism: false,
          sequence: { concurrent: false },
          testTimeout: 60_000,
          hookTimeout: 60_000,
        },
      },
      {
        extends: true,
        test: {
          name: 'http',
          environment: 'node',
          include: ['tests/http/**/*.test.ts'],
          setupFiles: ['tests/setup/db.ts'],
          // One build + one server for the whole run; the app and the DB
          // truncation must not race between files.
          globalSetup: ['tests/http/global-setup.ts'],
          fileParallelism: false,
          sequence: { concurrent: false },
          testTimeout: 60_000,
          hookTimeout: 120_000,
        },
      },
    ],
  },
});
