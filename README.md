This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## Environment

Connection strings and Neon Auth credentials live in `.env` (see `.env` for the
current set: `DATABASE_URL` pooled, `DATABASE_URL_UNPOOLED` for Prisma CLI).
`.env.example` lists the required keys with placeholder values.

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | yes | Pooled Postgres connection used by the app runtime. |
| `DATABASE_URL_UNPOOLED` | yes | Direct connection used by `prisma migrate` / introspection. |
| `APP_TIME_ZONE` | no | IANA zone (e.g. `Europe/Berlin`) used as the fallback for events with no stored zone, for no-JS form submits, and for browse day boundaries ("Today", "Next 7 days"). Defaults to `UTC`; this repo sets `Europe/Berlin`. **Set this in the deploy environment too** — `.env` is gitignored, so the deploy value is separate. |

## Verification

```bash
npm run typecheck   # tsc --noEmit
npm run lint        # repo-wide (generated Prisma client is ignored)
npm run verify      # typecheck + scoped lint + timezone probe + production build
npm test            # unit + component tests (no DB, no network)
npm run test:db     # DB integration tests (ephemeral Neon branch)
npm run verify:full # verify + every test layer
```

Database-backed tests run only against a disposable Neon branch created by
`npm run db:test:up`; see [`TESTING.md`](./TESTING.md) for the branch lifecycle,
the safety guard, and the full command reference. The legacy probe scripts
refuse writes unless `--allow-writes` (or `PROBE_ALLOW=1`) is passed and always
print the resolved host first.

`scripts/backfill-time-zone.ts` stamps legacy `Event.timeZone = null` rows with
`APP_TIME_ZONE`; it is a dry run unless `--apply --allow-writes` is passed.

## Testing

- `npm test` — Vitest unit + component projects. Safe on any machine.
- `npm run test:db` — Vitest DB integration against an ephemeral branch.
- `npm run test:http` — HTTP contract tests (Phase 4).
- `npm run test:e2e` — Playwright (desktop Chromium + Pixel 7).

Start with [`TESTING.md`](./TESTING.md) for setup, safety rules, and how to add
a regression test. The phased checklist lives in
[`testing_plan.md`](./testing_plan.md).

## Scheduled jobs

The `RateLimit` counter table is garbage-collected by an hourly Neon Function
Trigger declared in `neon.ts` (function `functions/rate-limit-cleanup.ts`). The
in-process sweep in `src/lib/rate-limit.ts` is best effort only. To run the same
delete by hand or from another scheduler:

```bash
npx tsx scripts/rate-limit-cleanup.ts          # dry run: reports stale rows
npx tsx scripts/rate-limit-cleanup.ts --apply  # deletes
```

Deploying the trigger and the fallback options (Vercel Cron, GitHub Actions) are
documented alongside the trigger declaration in `neon.ts`.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
