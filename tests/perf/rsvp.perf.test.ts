import { beforeEach, describe, expect, it } from 'vitest';
import { upsertRsvpCore } from '@/lib/rsvp';
import { prisma, resetDomainTables } from '../support/db';

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}

describe('performance: rsvp', () => {
  beforeEach(async () => {
    await resetDomainTables();
  });

  it('upsertRsvpCore p95 within budget', async () => {
    const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const event = await prisma.event.create({
      data: {
        title: 'RSVP perf event',
        description: 'Performance test event.',
        date: future,
        timeZone: 'Europe/Berlin',
        location: 'Perf venue',
        maxAttendees: null,
        isPublic: true,
        category: 'OTHER',
        userId: 'perf-organizer',
        organizerName: 'Perf Organizer',
      },
    });

    const userId = `perf-rsvp-user-${Date.now()}`;
    const statuses: Array<'GOING' | 'MAYBE'> = ['GOING', 'MAYBE'];
    const durations: number[] = [];

    for (let i = 0; i < 20; i += 1) {
      const start = performance.now();
      await upsertRsvpCore(userId, event.id, statuses[i % statuses.length]);
      durations.push(performance.now() - start);
    }

    const p50 = percentile(durations, 50);
    const p95 = percentile(durations, 95);
    console.log(`rsvp perf: p50=${p50.toFixed(1)}ms p95=${p95.toFixed(1)}ms (n=${durations.length})`);

    const budget = Number(process.env.PERF_RSVP_P95_MS ?? 1000);
    expect(p95).toBeLessThanOrEqual(budget);
  });
});
