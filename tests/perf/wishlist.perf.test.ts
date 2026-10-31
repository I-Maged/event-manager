import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getUserWishlist } from '@/lib/events';
import { prisma, resetDomainTables } from '../support/db';

describe('performance: wishlist query count', () => {
  beforeEach(async () => {
    await resetDomainTables();
  });

  it('getUserWishlist uses exactly two RSVP queries', async () => {
    const userId = `perf-wishlist-user-${Date.now()}`;
    const events = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        prisma.event.create({
          data: {
            title: `Wishlist perf event ${i}`,
            description: 'Performance test event.',
            date: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
            timeZone: 'Europe/Berlin',
            location: 'Perf venue',
            maxAttendees: 5,
            isPublic: true,
            category: 'OTHER',
            userId: 'perf-organizer',
            organizerName: 'Perf Organizer',
          },
        }),
      ),
    );

    await prisma.rSVP.createMany({
      data: events.map((event) => ({
        eventId: event.id,
        userId,
        status: 'WAITLISTED' as const,
      })),
    });

    const spy = vi.spyOn(prisma.rSVP, 'findMany');
    const result = await getUserWishlist(userId);
    expect(result).toHaveLength(6);
    expect(spy).toHaveBeenCalledTimes(2);
    spy.mockRestore();
  });
});
