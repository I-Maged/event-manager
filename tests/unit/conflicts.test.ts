import { describe, expect, it } from 'vitest';
import { eventsOverlap } from '@/lib/conflicts';

const h = (n: number) => new Date(1_700_000_000_000 + n * 60 * 60 * 1000);

describe('eventsOverlap', () => {
  it('overlaps within 2h', () => {
    expect(eventsOverlap(h(0), h(1))).toBe(true);
  });
  it('touching boundary is not overlap', () => {
    expect(eventsOverlap(h(0), h(2))).toBe(false);
  });
  it('far apart no overlap', () => {
    expect(eventsOverlap(h(0), h(5))).toBe(false);
  });
});
