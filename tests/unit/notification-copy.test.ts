import { describe, expect, it } from 'vitest';
import {
  buildNotificationCopyUser,
  generateNotificationCopy,
  parseNotificationCopy,
  NOTIFICATION_COPY_SYSTEM_PROMPT,
} from '@/lib/ai/notification-copy';

describe('parseNotificationCopy', () => {
  it('parses valid JSON', () => {
    expect(parseNotificationCopy('{"title":"Hi","body":"there"}')).toEqual({
      title: 'Hi',
      body: 'there',
    });
  });
  it('returns null on invalid JSON', () => {
    expect(parseNotificationCopy('not json')).toBeNull();
  });
  it('returns null when title/body missing', () => {
    expect(parseNotificationCopy('{"title":"Hi"}')).toBeNull();
    expect(parseNotificationCopy('{}')).toBeNull();
  });
  it('clamps lengths', () => {
    const long = 'a'.repeat(200);
    const res = parseNotificationCopy(JSON.stringify({ title: long, body: long }));
    expect(res?.title.length).toBe(80);
    expect(res?.body.length).toBe(200);
  });
  it('trims whitespace', () => {
    expect(parseNotificationCopy('{"title":"  hi  ","body":"  body  "}')).toEqual({
      title: 'hi',
      body: 'body',
    });
  });
});

describe('buildNotificationCopyUser', () => {
  it('includes category and change lines', () => {
    const out = buildNotificationCopyUser({
      kind: 'EVENT_UPDATED',
      event: { title: 'T', category: 'TECH', location: 'L', date: new Date('2026-01-01T00:00:00Z'), timeZone: 'UTC' },
      changeLines: ['Location is now L'],
    });
    expect(out).toContain('Category: TECH');
    expect(out).toContain('Location is now L');
  });
});

describe('generateNotificationCopy', () => {
  it('uses injected client and parses result', async () => {
    const client = { complete: async () => '{"title":"t","body":"b"}' };
    const res = await generateNotificationCopy(
      { kind: 'PROMOTION', event: { title: 'E' } },
      client,
    );
    expect(res).toEqual({ title: 't', body: 'b' });
  });
  it('returns null when client throws', async () => {
    const client = { complete: async () => { throw new Error('boom'); } };
    const res = await generateNotificationCopy(
      { kind: 'PROMOTION', event: { title: 'E' } },
      client,
    );
    expect(res).toBeNull();
  });
  it('returns null on invalid JSON from client', async () => {
    const client = { complete: async () => 'not json' };
    const res = await generateNotificationCopy(
      { kind: 'PROMOTION', event: { title: 'E' } },
      client,
    );
    expect(res).toBeNull();
  });
  it('respects timeout', async () => {
    const client = { complete: () => new Promise<string>(() => {}) };
    const res = await generateNotificationCopy(
      { kind: 'PROMOTION', event: { title: 'E' } },
      client,
      10,
    );
    expect(res).toBeNull();
  });
});

// keep prompt referenced
void NOTIFICATION_COPY_SYSTEM_PROMPT;