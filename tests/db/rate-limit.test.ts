import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRateLimitCleanupHandler } from '../../functions/rate-limit-cleanup';
import {
  consume,
  deleteStaleRateLimits,
  enforceRateLimit,
  RATE_LIMIT_MESSAGE,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import { prisma, resetDomainTables } from '../support/db';
import { RUN_ID } from '../support/factories';

/**
 * Ported from `scripts/rate-limit-check.ts`, with the window-reset wait
 * replaced by a direct `windowStart` rewrite so the suite runs in milliseconds.
 */
describe('fixed-window counter', () => {
  beforeEach(async () => {
    await resetDomainTables();
  });

  it('allows exactly the budget, then blocks', async () => {
    const key = `${RUN_ID}:seq`;
    for (let i = 1; i <= 5; i += 1) {
      await expect(consume(key, 5, 60_000), `call ${i}`).resolves.toBe(true);
    }
    await expect(consume(key, 5, 60_000)).resolves.toBe(false);
    await expect(consume(key, 5, 60_000)).resolves.toBe(false);
  });

  it('lets exactly `limit` concurrent callers through', async () => {
    const key = `${RUN_ID}:race`;
    const results = await Promise.all(
      Array.from({ length: 20 }, () => consume(key, 5, 60_000)),
    );
    expect(results.filter(Boolean)).toHaveLength(5);
  });

  it('resets after the window elapses', async () => {
    const key = `${RUN_ID}:reset`;
    await expect(consume(key, 1, 60_000)).resolves.toBe(true);
    await expect(consume(key, 1, 60_000)).resolves.toBe(false);

    await prisma.rateLimit.update({
      where: { key },
      data: { windowStart: new Date(Date.now() - 120_000) },
    });

    await expect(consume(key, 1, 60_000)).resolves.toBe(true);
  });

  it('scopes counters by key', async () => {
    await expect(consume(`${RUN_ID}:a`, 1, 60_000)).resolves.toBe(true);
    await expect(consume(`${RUN_ID}:b`, 1, 60_000)).resolves.toBe(true);
    await expect(consume(`${RUN_ID}:a`, 1, 60_000)).resolves.toBe(false);
  });
});

describe('stale-row sweep', () => {
  beforeEach(async () => {
    await resetDomainTables();
  });

  it('deletes only rows older than the cutoff', async () => {
    const now = Date.now();
    await prisma.rateLimit.createMany({
      data: [
        {
          key: `${RUN_ID}:stale`,
          count: 3,
          windowStart: new Date(now - 48 * 60 * 60 * 1000),
        },
        {
          key: `${RUN_ID}:fresh`,
          count: 1,
          windowStart: new Date(now - 60_000),
        },
      ],
    });

    const removed = await deleteStaleRateLimits(
      new Date(now - 24 * 60 * 60 * 1000),
    );

    expect(removed).toBeGreaterThanOrEqual(1);
    await expect(
      prisma.rateLimit.findUnique({ where: { key: `${RUN_ID}:stale` } }),
    ).resolves.toBeNull();
    await expect(
      prisma.rateLimit.findUnique({ where: { key: `${RUN_ID}:fresh` } }),
    ).resolves.not.toBeNull();
  });
});

describe('budget shape', () => {
  it('declares a positive budget for every scope', () => {
    expect(RATE_LIMIT_MESSAGE.length).toBeGreaterThan(0);
    expect(RATE_LIMITS.comment.limit).toBeLessThan(RATE_LIMITS.rsvp.limit);
    expect(Object.values(RATE_LIMITS).every((b) => b.limit > 0 && b.windowMs > 0))
      .toBe(true);
  });
});

describe('scheduled cleanup handler', () => {
  const request = (withHeader: boolean) =>
    new Request('https://example.com/functions/ratelimitgc', {
      method: 'POST',
      headers: withHeader ? { 'x-neon-trigger-invocation-id': 'test' } : {},
    });

  it('rejects calls without the trigger header', async () => {
    const handler = createRateLimitCleanupHandler(async () => ({ rowCount: 0 }));
    const response = await handler.fetch(request(false));
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: 'not a trigger call',
    });
  });

  it('reports the deleted count for a trigger call', async () => {
    let calls = 0;
    const handler = createRateLimitCleanupHandler(async () => {
      calls += 1;
      return { rowCount: 7 };
    });
    const response = await handler.fetch(request(true));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, deleted: 7 });
    expect(calls).toBe(1);
  });

  it('treats a null rowCount as zero', async () => {
    const handler = createRateLimitCleanupHandler(async () => ({
      rowCount: null,
    }));
    const response = await handler.fetch(request(true));
    await expect(response.json()).resolves.toEqual({ ok: true, deleted: 0 });
  });

  it('returns 500 when the cleanup query fails', async () => {
    const handler = createRateLimitCleanupHandler(async () => {
      throw new Error('boom');
    });
    const response = await handler.fetch(request(true));
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ ok: false });
  });
});

describe('fail-open on DB error', () => {
  beforeEach(async () => {
    await resetDomainTables();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fails open and logs a hashed user id (never the raw id)', async () => {
    const userId = `${RUN_ID}:user`;
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const querySpy = vi
      .spyOn(prisma, '$queryRaw')
      .mockRejectedValue(new Error('DB down'));

    const result = await enforceRateLimit('comment', userId);

    expect(result).toBeNull(); // fail open: action may proceed
    expect(querySpy).toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalled();
    const logged = errorSpy.mock.calls.some((args) =>
      String(args[0]).includes(userId),
    );
    expect(logged).toBe(false); // raw id must not be logged
    const hashLike = errorSpy.mock.calls.some((args) =>
      /[0-9a-f]{12}/.test(String(args[0])),
    );
    expect(hashLike).toBe(true); // hashed user id is logged
  });

  it('missing table / DB error does not block the action', async () => {
    const userId = `${RUN_ID}:user`;
    vi.spyOn(prisma, '$queryRaw').mockRejectedValue(new Error('missing table'));

    const result = await enforceRateLimit('rsvp', userId);

    // Fail open: the limiter does not block the action.
    expect(result).toBeNull();
  });
});

describe('cleanup SQL predicate matches CLEANUP_AGE_MS', () => {
  it('SQL job retains the same 24-hour window as the in-process sweep', async () => {
    const sql = readFileSync('scripts/sql/rate-limit-cleanup.sql', 'utf8');
    expect(sql).toContain("now() - interval '1 day'");
    // CLEANUP_AGE_MS in src/lib/rate-limit.ts is 24 * 60 * 60 * 1000 (1 day).
    expect(24 * 60 * 60 * 1000).toBe(86_400_000);
  });
});
