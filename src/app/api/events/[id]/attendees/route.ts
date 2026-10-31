import { auth } from '@/lib/auth/server';
import { createAttendeeCsvStream } from '@/lib/attendee-csv';
import { getAttendeesPage, getEventById } from '@/lib/events';

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

  // Streaming (and the mid-export failure path) lives in `@/lib/attendee-csv`
  // so it can be tested without a running app; see Phase 6 / 4.2.
  const stream = createAttendeeCsvStream({
    eventId: event.id,
    signal: req.signal,
    fetchPage: ({ cursor, take }) => getAttendeesPage(event, userId, { cursor, take }),
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="event-${id}-attendees.csv"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
