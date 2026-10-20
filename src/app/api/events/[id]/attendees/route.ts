import { auth } from '@/lib/auth/server';
import {
  getAttendeesPage,
  getEventById,
  type AttendeeCsvRow,
} from '@/lib/events';

const PAGE_SIZE = 500;

function csvCell(value: string): string {
  // Prevent spreadsheet formula injection + escape quotes.
  const safe = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const { data: session } = await auth.getSession();
  const userId = session?.user?.id ?? null;
  if (!userId) {
    return new Response('Unauthorized', { status: 401 });
  }
  const event = await getEventById(id);
  if (!event || event.userId !== userId) {
    return new Response('Not found', { status: 404 });
  }

  const encoder = new TextEncoder();
  const csvLine = (a: AttendeeCsvRow) =>
    [
      csvCell(a.status),
      csvCell(a.attendeeName ?? ''),
      csvCell(a.createdAt.toISOString()),
      csvCell(a.checkedInAt?.toISOString() ?? ''),
    ].join(',');

  // Cursor-page the roster and stream it so a large export never buffers the
  // whole attendee list (or the whole CSV) in memory.
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(encoder.encode('status,name,joined_at,checked_in\n'));
      let cursor: string | undefined;
      try {
        for (;;) {
          if (cancelled || req.signal.aborted) break;
          const rows = await getAttendeesPage(event, userId, {
            cursor,
            take: PAGE_SIZE,
          });
          if (rows.length === 0) break;
          controller.enqueue(
            encoder.encode(rows.map(csvLine).join('\n') + '\n'),
          );
          if (rows.length < PAGE_SIZE) break;
          cursor = rows[rows.length - 1].id;
        }
        if (!cancelled) controller.close();
      } catch (error) {
        console.error('attendee CSV stream failed', { eventId: id, error });
        if (!cancelled) controller.error(error);
      }
    },
    cancel() {
      cancelled = true;
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="event-${id}-attendees.csv"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
