import { notFound, redirect } from 'next/navigation';
import { auth } from '@/lib/auth/server';
import { getEventById } from '@/lib/events';
import { toDatetimeLocalValue } from '@/lib/event-validation';
import { EditEventForm } from './EditEventForm';

export const metadata = {
  title: 'Edit event | EventPlanner',
};

// Organizer check requires the session: render on demand.
export const instant = false;

export default async function EditEventPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { data: session } = await auth.getSession();
  const userId = session?.user?.id;
  if (!userId) redirect('/auth/sign-in');

  const event = await getEventById(id);
  if (!event) notFound();
  if (event.userId !== userId) redirect('/events');

  return (
    <div className="max-w-xl mx-auto">
      <EditEventForm
        initial={{
          eventId: event.id,
          title: event.title,
          description: event.description,
          dateValue: toDatetimeLocalValue(event.date),
          location: event.location,
          maxAttendees:
            event.maxAttendees != null ? String(event.maxAttendees) : '',
          isPublic: event.isPublic,
        }}
      />
    </div>
  );
}
