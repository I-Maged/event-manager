'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { prisma } from '@/db';
import { auth } from '@/lib/auth/server';
import { parseEventForm } from '@/lib/event-validation';
import { resolveOrganizerName } from '@/lib/events';

async function requireOrganizer(eventId: string) {
  const { data: session } = await auth.getSession();
  const userId = session?.user?.id;
  if (!userId) redirect('/auth/sign-in');
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { userId: true },
  });
  if (!event || event.userId !== userId) redirect('/events');
  return { userId, organizerName: resolveOrganizerName(session?.user) };
}

export async function updateEvent(
  _prevState: { error: string } | null,
  formData: FormData,
) {
  const eventId = formData.get('eventId') as string;
  if (!eventId) return { error: 'Missing event id.' };
  const { organizerName } = await requireOrganizer(eventId);

  const parsed = parseEventForm(formData, { requireFutureDate: false });
  if (!parsed.ok) return { error: parsed.error };

  // Prevent shrinking capacity below the current GOING count.
  if (parsed.data.maxAttendees !== null) {
    const going = await prisma.rSVP.count({
      where: { eventId, status: 'GOING' },
    });
    if (parsed.data.maxAttendees < going) {
      return {
        error: `Capacity cannot be below the ${going} guests already going.`,
      };
    }
  }

  await prisma.event.update({
    where: { id: eventId },
    data: { ...parsed.data, organizerName },
  });

  revalidatePath('/events');
  revalidatePath(`/events/${eventId}`);
  redirect(`/events/${eventId}`);
}

export async function deleteEvent(formData: FormData) {
  const eventId = formData.get('eventId') as string;
  if (!eventId) redirect('/events');
  await requireOrganizer(eventId);

  await prisma.event.delete({ where: { id: eventId } });

  revalidatePath('/events');
  redirect('/events');
}
