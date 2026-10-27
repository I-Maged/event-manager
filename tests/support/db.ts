import { prisma } from '@/db';

export { prisma };

const DOMAIN_TABLES = [
  '"Notification"',
  '"Comment"',
  '"RSVP"',
  '"Event"',
  '"RateLimit"',
];

/**
 * Truncate only the app's domain tables, resetting the run to a known state.
 * `neon_auth` is deliberately untouched: identity lives on the branch and is
 * managed by the provider, not by these tests.
 */
export async function resetDomainTables(): Promise<void> {
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE ${DOMAIN_TABLES.join(', ')} RESTART IDENTITY CASCADE`,
  );
}

/** Remove one event and everything that cascades from it. */
export async function deleteEvent(eventId: string): Promise<void> {
  await prisma.event.deleteMany({ where: { id: eventId } });
}

export async function closeDb(): Promise<void> {
  await prisma.$disconnect();
}
