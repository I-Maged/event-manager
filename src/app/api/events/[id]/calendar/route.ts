import { auth } from '@/lib/auth/server';
import { buildIcs } from '@/lib/calendar';
import { canViewEvent, getEventById } from '@/lib/events';

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const event = await getEventById(id);
  const { data: session } = await auth.getSession();
  const userId = session?.user?.id ?? null;
  // 404 (not 403) to avoid enumerating private events; matches detail page.
  if (!event || !(await canViewEvent(event, userId))) {
    return new Response('Not found', { status: 404 });
  }
  let origin: string | null = null;
  try {
    origin = new URL(req.url).origin;
  } catch {
    origin = null;
  }
  const ics = buildIcs(event, { origin });
  return new Response(ics, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `attachment; filename="event-${id}.ics"`,
      'Cache-Control': 'no-store',
    },
  });
}
