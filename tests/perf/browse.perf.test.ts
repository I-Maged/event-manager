import { beforeEach, describe, expect, it } from 'vitest';
import { getPublicEventsPageCore } from '@/lib/events';
import { prisma, resetDomainTables } from '../support/db';

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}

describe('performance: browse', () => {
  beforeEach(async () => {
    await resetDomainTables();
  });

  it('getPublicEventsPageCore p95 within budget', async () => {
    const now = new Date('2026-11-01T10:00:00Z');
    const organizerId = `perf-organizer-${Date.now()}`;
    const events = Array.from({ length: 500 }, (_, i) => ({
      title: `Perf event ${i}`,
      description: 'Performance test event.',
      date: new Date(now.getTime() + (i % 30) * 24 * 60 * 60 * 1000 + (i % 1440) * 60 * 1000),
      timeZone: 'Europe/Berlin',
      location: 'Perf venue',
      maxAttendees: null,
      isPublic: true,
      category: 'OTHER' as const,
      userId: organizerId,
      organizerName: 'Perf Organizer',
    }));
    await prisma.event.createMany({ data: events });

    const created = await prisma.event.findMany({ select: { id: true }, take: 500 });
    const eventIds = created.map((event) => event.id);
    const rsvps = Array.from({ length: 1000 }, (_, i) => ({
      eventId: eventIds[i % eventIds.length],
      userId: `perf-user-${i}`,
      status: 'GOING' as const,
    }));
    await prisma.rSVP.createMany({ data: rsvps });

    const baseParams = {
      category: null,
      organizer: null,
      page: 1,
      q: '',
      sort: 'date' as const,
      when: 'any' as const,
    };

    for (let i = 0; i < 5; i += 1) {
      await getPublicEventsPageCore(baseParams, now);
    }

    const durations: number[] = [];
    for (let i = 0; i < 20; i += 1) {
      const start = performance.now();
      await getPublicEventsPageCore(baseParams, now);
      durations.push(performance.now() - start);
    }

    const p50 = percentile(durations, 50);
    const p95 = percentile(durations, 95);
    console.log(`browse perf: p50=${p50.toFixed(1)}ms p95=${p95.toFixed(1)}ms (n=${durations.length})`);

    const budget = Number(process.env.PERF_BROWSE_P95_MS ?? 2000);
    expect(p95).toBeLessThanOrEqual(budget);
  });
});
