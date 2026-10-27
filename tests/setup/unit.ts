/**
 * Unit-project setup. Runs before any test module is imported, so
 * `DEFAULT_TIME_ZONE` in `src/lib/time.ts` is computed from this value.
 * Tests that need the UTC fallback re-import the module with `vi.resetModules`.
 */
process.env.APP_TIME_ZONE ??= 'Europe/Berlin';

// Pure modules such as `src/lib/events.ts` import the Prisma singleton. Client
// construction is lazy (PrismaNeon opens no connection until a query runs), so
// a placeholder URL keeps the unit project DB-free without a test seam.
process.env.DATABASE_URL ??= 'postgresql://unit:unit@127.0.0.1:5432/unit';

