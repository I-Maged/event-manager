/**
 * RSVP concurrency probe — DEV BRANCH ONLY.
 *
 * Proves the RSVP mutation path cannot overbook a capped event and cannot
 * double-promote (or under-promote) a waitlisted row under concurrent
 * writers. Run it *before* the advisory-lock fix to capture the failure as
 * evidence, then again after to show it holds.
 *
 *   npx tsx scripts/rsvp-concurrency.ts
 *
 * Exit code 0 = every invariant held; 1 = at least one broke.
 * Every fixture is prefixed `probe-` and deleted by eventId afterwards.
 */
import 'dotenv/config';
import { prisma } from '@/db';
import {
  cancelRsvpCore,
  promoteFromWishlist,
  upsertRsvpCore,
} from '@/lib/rsvp';

// The bug is a scheduling race, so each concurrency scenario runs repeatedly.
// Both counts are overridable for quick local experiments.
const ROUNDS = Number(process.env.PROBE_ROUNDS ?? 6);
const RACERS = Number(process.env.PROBE_RACERS ?? 8);

const failures: string[] = [];

const futureDate = () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

function probeUsers(tag: string, n: number): string[] {
  return Array.from({ length: n }, (_, i) => `probe-${tag}-u${i}`);
}

async function createProbeEvent(tag: string, maxAttendees: number | null) {
  return prisma.event.create({
    data: {
      title: `probe-${tag}-${Date.now()}`,
      description: 'concurrency probe fixture',
      date: futureDate(),
      location: 'probe',
      maxAttendees,
      userId: `probe-${tag}-org`,
    },
    select: { id: true },
  });
}

async function cleanup(eventId: string) {
  await prisma.rSVP.deleteMany({ where: { eventId } });
  await prisma.event.deleteMany({ where: { id: eventId } });
}

async function counts(eventId: string) {
  const [going, waitlisted, promoted] = await Promise.all([
    prisma.rSVP.count({ where: { eventId, status: 'GOING' } }),
    prisma.rSVP.count({ where: { eventId, status: 'WAITLISTED' } }),
    prisma.rSVP.count({ where: { eventId, promotedAt: { not: null } } }),
  ]);
  return { going, waitlisted, promoted };
}

/** cap = 1, 8 racers: exactly one may end up GOING. */
async function scenarioA(round: number) {
  const event = await createProbeEvent('a', 1);
  const users = probeUsers('a', RACERS);
  try {
    await Promise.all(
      users.map((u) => upsertRsvpCore(u, event.id, 'GOING', `Guest ${u}`)),
    );
    const { going, waitlisted } = await counts(event.id);
    if (going !== 1 || waitlisted !== RACERS - 1) {
      failures.push(
        `A round ${round}: OVERBOOKED — cap 1, ${RACERS} racers -> ` +
          `${going} GOING / ${waitlisted} WAITLISTED`,
      );
    }
  } finally {
    await cleanup(event.id);
  }
}

/**
 * cap = 2 with both seats taken and two waitlisted. Two GOING holders cancel
 * concurrently: both freed seats must be filled by two *distinct* waitlisted
 * users (no double-promotion, no seat left unfilled while someone waits).
 */
async function scenarioB(round: number) {
  const event = await createProbeEvent('b', 2);
  const [a, b, w1, w2] = probeUsers('b', 4);
  try {
    await prisma.rSVP.createMany({
      data: [
        { eventId: event.id, userId: a, status: 'GOING' },
        { eventId: event.id, userId: b, status: 'GOING' },
        { eventId: event.id, userId: w1, status: 'WAITLISTED' },
        { eventId: event.id, userId: w2, status: 'WAITLISTED' },
      ],
    });

    await Promise.all([
      cancelRsvpCore(a, event.id),
      cancelRsvpCore(b, event.id),
    ]);

    const { going, promoted } = await counts(event.id);
    const promotedRows = await prisma.rSVP.findMany({
      where: { eventId: event.id, promotedAt: { not: null } },
      select: { userId: true },
    });
    const distinct = new Set(promotedRows.map((r) => r.userId)).size;

    const problems: string[] = [];
    if (going !== 2) problems.push(`${going} GOING (expected 2)`);
    if (promoted !== 2) problems.push(`${promoted} promoted rows (expected 2)`);
    if (distinct !== 2)
      problems.push(`${distinct} distinct promotees (expected 2)`);
    if (problems.length > 0) {
      failures.push(`B round ${round}: ${problems.join('; ')}`);
    }
  } finally {
    await cleanup(event.id);
  }
}

/**
 * Capacity-raise semantics: raising the cap inside the transaction that owns
 * the event lock must promote exactly the freed slots.
 */
async function scenarioC() {
  const event = await createProbeEvent('c', 1);
  const [first, ...rest] = probeUsers('c', 4);
  try {
    await upsertRsvpCore(first, event.id, 'GOING', 'first');
    await Promise.all(
      rest.map((u) => upsertRsvpCore(u, event.id, 'GOING', u)),
    );

    const promoted = await prisma.$transaction(async (tx) => {
      await tx.event.update({
        where: { id: event.id },
        data: { maxAttendees: 3 },
      });
      return promoteFromWishlist(tx, event.id, 3);
    });

    const { going, waitlisted, promoted: promotedRows } = await counts(
      event.id,
    );
    const problems: string[] = [];
    if (going !== 3) problems.push(`${going} GOING (expected 3)`);
    if (waitlisted !== 1) problems.push(`${waitlisted} WAITLISTED (expected 1)`);
    if (promoted.length !== 2)
      problems.push(`${promoted.length} promoted (expected 2)`);
    if (promotedRows !== 2)
      problems.push(`${promotedRows} promoted rows (expected 2)`);
    if (problems.length > 0) failures.push(`C: ${problems.join('; ')}`);
  } finally {
    await cleanup(event.id);
  }
}

async function main() {
  try {
    for (let round = 1; round <= ROUNDS; round += 1) {
      await scenarioA(round);
      await scenarioB(round);
    }
    await scenarioC();

    if (failures.length > 0) {
      console.error(`\n${failures.length} concurrency invariant failure(s):`);
      for (const failure of failures) console.error(`  - ${failure}`);
      return 1;
    }

    console.log('RSVP concurrency probe: all invariants held.');
    return 0;
  } finally {
    await prisma.$disconnect();
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    console.error(
      'probe run failed:',
      error instanceof Error ? (error.stack ?? error.message) : error,
    );
    process.exitCode = 1;
  });
