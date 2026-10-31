import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ATTENDEE_CSV_HEADER,
  ATTENDEE_CSV_PAGE_SIZE,
  attendeeCsvLine,
  createAttendeeCsvStream,
  csvCell,
  type AttendeePageFetch,
} from '@/lib/attendee-csv';
import type { AttendeeCsvRow } from '@/lib/events';

/**
 * Phase 6 / 4.2 — the CSV export's failure path.
 *
 * A stream that has already written its first chunk cannot change its status:
 * the honest contract is "error the stream so the client sees an aborted body"
 * plus one log line. That branch is unreachable from the HTTP layer (the app is
 * a separate process for those tests), so it is asserted here against the
 * extracted builder with an injected page fetcher.
 */

function makeRow(id: string, overrides: Partial<AttendeeCsvRow> = {}): AttendeeCsvRow {
  return {
    id,
    userId: `user-${id}`,
    attendeeName: `Attendee ${id}`,
    status: 'GOING',
    createdAt: new Date('2026-11-01T10:00:00Z'),
    checkedInAt: null,
    ...overrides,
  };
}

async function readStream(stream: ReadableStream<Uint8Array>): Promise<{
  text: string;
  error: unknown;
}> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = '';
  let error: unknown = null;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }
  } catch (caught) {
    error = caught;
  }
  return { text, error };
}

describe('CSV cells', () => {
  it('neutralizes formula prefixes and escapes quotes', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('+1')).toBe(`"'+1"`);
    expect(csvCell('-1')).toBe(`"'-1"`);
    expect(csvCell('@cmd')).toBe(`"'@cmd"`);
    expect(csvCell('plain')).toBe('"plain"');
  });

  it('formats a roster row with an ISO timestamp and an empty check-in', () => {
    expect(attendeeCsvLine(makeRow('row-1', { attendeeName: 'Ada, Lovelace' }))).toBe(
      '"GOING","Ada, Lovelace","2026-11-01T10:00:00.000Z",""',
    );
  });
});

describe('Attendee CSV stream', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('pages through the roster and closes on a short page', async () => {
    const firstPage = Array.from({ length: ATTENDEE_CSV_PAGE_SIZE }, (_, index) =>
      makeRow(`row-${index}`),
    );
    const lastPage = [makeRow('row-last-1'), makeRow('row-last-2'), makeRow('row-last-3')];
    const calls: { cursor?: string; take: number }[] = [];
    const fetchPage: AttendeePageFetch = async (page) => {
      calls.push(page);
      return calls.length === 1 ? firstPage : lastPage;
    };

    const stream = createAttendeeCsvStream({ eventId: 'event-1', fetchPage });
    const { text, error } = await readStream(stream);

    expect(error).toBeNull();
    expect(text.startsWith(ATTENDEE_CSV_HEADER)).toBe(true);
    // Header + 500 + 3 rows.
    expect(text.split('\n').filter((line) => line.length > 0)).toHaveLength(504);
    expect(text).toContain('"Attendee row-0"');
    expect(text).toContain('"Attendee row-last-3"');

    // Second page resumes from the last id of the first page.
    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual({ cursor: undefined, take: ATTENDEE_CSV_PAGE_SIZE });
    expect(calls[1]).toEqual({
      cursor: `row-${ATTENDEE_CSV_PAGE_SIZE - 1}`,
      take: ATTENDEE_CSV_PAGE_SIZE,
    });
  });

  it('errors the stream instead of ending cleanly when a page fails', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const failure = new Error('page 2 unavailable');
    let calls = 0;
    const fetchPage: AttendeePageFetch = async () => {
      calls += 1;
      if (calls === 1) {
        return Array.from({ length: ATTENDEE_CSV_PAGE_SIZE }, (_, index) =>
          makeRow(`row-${index}`),
        );
      }
      throw failure;
    };

    const stream = createAttendeeCsvStream({ eventId: 'event-2', fetchPage });
    const { error } = await readStream(stream);

    // An unread, queued chunk is discarded by `controller.error`, so the
    // assertion is about the failure signal, not about partial rows.
    expect(error).toBe(failure);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(String(errorSpy.mock.calls[0]?.[0])).toContain('attendee CSV stream failed');
    const meta = errorSpy.mock.calls[0]?.[1] as { eventId?: string; error?: unknown };
    expect(meta.eventId).toBe('event-2');
    expect(meta.error).toBe(failure);
  });

  it('closes after the header when the request is already aborted', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const controller = new AbortController();
    controller.abort();
    let calls = 0;
    const fetchPage: AttendeePageFetch = async () => {
      calls += 1;
      return [makeRow('row-1')];
    };

    const stream = createAttendeeCsvStream({
      eventId: 'event-3',
      signal: controller.signal,
      fetchPage,
    });
    const { text, error } = await readStream(stream);

    expect(error).toBeNull();
    expect(text).toBe(ATTENDEE_CSV_HEADER);
    expect(calls).toBe(0);
    expect(errorSpy).not.toHaveBeenCalled();
  });
});
