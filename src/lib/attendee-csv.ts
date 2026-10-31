import type { AttendeeCsvRow } from '@/lib/events';

/**
 * Attendee CSV export as a byte stream.
 *
 * Extracted from the route handler so the failure path is testable without a
 * live app: once the first chunk is written the response status is already
 * `200`, so the only honest handling for a mid-export database error is
 * `controller.error(...)` (the client sees an aborted body, never a truncated
 * one that looks complete) plus one correlatable log line. The page fetcher is
 * injected, which keeps this module free of Prisma and of `connection()`.
 */

/** Rows queried per page. 500 keeps a big export's memory flat. */
export const ATTENDEE_CSV_PAGE_SIZE = 500;

/** Header row; also the first chunk so a client sees bytes immediately. */
export const ATTENDEE_CSV_HEADER = 'status,name,joined_at,checked_in\n';

/** Prevent spreadsheet formula injection + escape quotes. */
export function csvCell(value: string): string {
  // Neutralize spreadsheet formula injection. Leading whitespace, tab, or CR
  // before a formula prefix is included because spreadsheet apps may trim
  // the cell before evaluating it.
  const safe = /^[ \t\r\n=+\-@]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function attendeeCsvLine(row: AttendeeCsvRow): string {
  return [
    csvCell(row.status),
    csvCell(row.attendeeName ?? ''),
    csvCell(row.createdAt.toISOString()),
    csvCell(row.checkedInAt?.toISOString() ?? ''),
  ].join(',');
}

export type AttendeePageFetch = (page: {
  cursor?: string;
  take: number;
}) => Promise<AttendeeCsvRow[]>;

/**
 * Cursor-page the roster and stream it, so a large export never buffers the
 * attendee list (or the whole CSV) in memory.
 */
export function createAttendeeCsvStream(options: {
  eventId: string;
  fetchPage: AttendeePageFetch;
  signal?: AbortSignal;
}): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let cancelled = false;

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(encoder.encode(ATTENDEE_CSV_HEADER));
      let cursor: string | undefined;
      try {
        for (;;) {
          if (cancelled || options.signal?.aborted) break;
          const rows = await options.fetchPage({
            cursor,
            take: ATTENDEE_CSV_PAGE_SIZE,
          });
          if (rows.length === 0) break;
          controller.enqueue(encoder.encode(rows.map(attendeeCsvLine).join('\n') + '\n'));
          if (rows.length < ATTENDEE_CSV_PAGE_SIZE) break;
          cursor = rows[rows.length - 1].id;
        }
        if (!cancelled) controller.close();
      } catch (error) {
        console.error('attendee CSV stream failed', {
          eventId: options.eventId,
          error,
        });
        if (!cancelled) controller.error(error);
      }
    },
    cancel() {
      cancelled = true;
    },
  });
}
