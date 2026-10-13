import { auth } from '@/lib/auth/server';
import { getAttendees, getEventById } from '@/lib/events';

function csvCell(value: string): string {
  // Prevent spreadsheet formula injection + escape quotes.
  const safe = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

export async function GET(
  _req: Request,
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
  const attendees = await getAttendees(id);
  const lines = ['status,name,joined_at'];
  for (const a of attendees) {
    lines.push(
      [
        csvCell(a.status),
        csvCell(a.attendeeName ?? ''),
        csvCell(a.createdAt.toISOString()),
      ].join(','),
    );
  }
  return new Response(lines.join('\n'), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="event-${id}-attendees.csv"`,
    },
  });
}
