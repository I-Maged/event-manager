'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { prisma } from '@/db';
import { auth } from '@/lib/auth/server';
import { parseEventForm } from '@/lib/event-validation';
import { formatEventDate, resolveOrganizerName } from '@/lib/events';
import { notifyUsers } from '@/lib/notifications';

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

  // Pre-update snapshot for the EVENT_UPDATED diff below.
  const before = await prisma.event.findUnique({
    where: { id: eventId },
    select: { title: true, date: true, location: true, userId: true },
  });
  if (!before) return { error: 'Event not found.' };

  await prisma.event.update({
    where: { id: eventId },
    data: { ...parsed.data, organizerName },
  });

  // Best-effort EVENT_UPDATED fan-out: only when title/date/location
  // actually changed, only to GOING/MAYBE/WAITLISTED holders who opted in,
  // never to the organizer who made the edit.
  const changeLines: string[] = [];
  if (parsed.data.title !== before.title) {
    changeLines.push(`Title is now “${parsed.data.title}”`);
  }
  if (parsed.data.location !== before.location) {
    changeLines.push(`Location is now ${parsed.data.location}`);
  }
  if (parsed.data.date.getTime() !== before.date.getTime()) {
    changeLines.push(`Date is now ${formatEventDate(parsed.data.date)}`);
  }
  if (changeLines.length > 0) {
    try {
      const holders = await prisma.rSVP.findMany({
        where: {
          eventId,
          status: { in: ['GOING', 'MAYBE', 'WAITLISTED'] },
          notifyOnUpdate: true,
          NOT: { userId: before.userId },
        },
        select: { userId: true },
      });
      if (holders.length > 0) {
        await notifyUsers(
          holders.map((h) => ({
            userId: h.userId,
            eventId,
            type: 'EVENT_UPDATED' as const,
            title: `Event updated: ${parsed.data.title}`,
            body: changeLines.join(' · '),
          })),
        );
        revalidatePath('/notifications');
      }
    } catch (error) {
      console.error('event update notify fan-out failed', { eventId, error });
    }
  }

  revalidatePath('/events');
  revalidatePath(`/events/${eventId}`);
  redirect(`/events/${eventId}`);
}

export async function deleteEvent(formData: FormData) {
  const eventId = formData.get('eventId') as string;
  if (!eventId) redirect('/events');
  await requireOrganizer(eventId);

  // Capture recipients BEFORE the delete: cascade wipes RSVPs, and
  // Notification.event is onDelete:Cascade, so cancellation notices must
  // use eventId:null with the title baked into the text.
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { title: true, date: true, location: true, userId: true },
  });
  if (!event) redirect('/events');
  const holders = await prisma.rSVP.findMany({
    where: {
      eventId,
      status: { in: ['GOING', 'MAYBE', 'WAITLISTED'] },
      notifyOnUpdate: true,
      NOT: { userId: event.userId },
    },
    select: { userId: true },
  });

  await prisma.event.delete({ where: { id: eventId } });

  // Best-effort EVENT_CANCELLED fan-out (opt-out respected).
  if (holders.length > 0) {
    try {
      await notifyUsers(
        holders.map((h) => ({
          userId: h.userId,
          eventId: null,
          type: 'EVENT_CANCELLED' as const,
          title: `Event cancelled: ${event.title}`,
          body: `${formatEventDate(event.date)} at ${event.location} will not take place.`,
        })),
      );
    } catch (error) {
      console.error('event cancel notify fan-out failed', { eventId, error });
    }
  }

  revalidatePath('/events');
  revalidatePath('/notifications');
  redirect('/events');
}
