'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { prisma } from '@/db';
import { auth } from '@/lib/auth/server';
import { parseEventForm } from '@/lib/event-validation';
import { resolveOrganizerName } from '@/lib/events';
import {
  notifyEventCancelled,
  notifyEventUpdated,
  selectEventUpdateRecipients,
} from '@/lib/event-notifications';
import { updateEventCore } from '@/lib/update-event';
import { notifyPromotions } from '@/lib/rsvp';
import { enforceRateLimit } from '@/lib/rate-limit';

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
  const { userId, organizerName } = await requireOrganizer(eventId);
  const limited = await enforceRateLimit('eventEdit', userId);
  if (limited) return { error: limited.error };

  const parsed = parseEventForm(formData, { requireFutureDate: false });
  if (!parsed.ok) return { error: parsed.error };

  const outcome = await updateEventCore(eventId, parsed.data, organizerName, userId);

  if (!outcome.ok) return { error: outcome.error };
  const { before, promoted, timeZone } = outcome;

  // Best-effort PROMOTION fan-out for anyone who just got a freed seat.
  if (promoted.length > 0) {
    await notifyPromotions(
      eventId,
      parsed.data.title,
      parsed.data.date,
      parsed.data.location,
      promoted,
      timeZone,
    );
    revalidatePath('/notifications');
  }

  // Best-effort EVENT_UPDATED fan-out: only when title/date/location
  // actually changed, only to GOING/MAYBE/WAITLISTED holders who opted in,
  // never to the organizer who made the edit.
  const notified = await notifyEventUpdated({
    eventId,
    organizerId: before.userId,
    before,
    after: parsed.data,
    timeZone,
  });
  if (notified > 0) revalidatePath('/notifications');

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
    select: { title: true, date: true, timeZone: true, location: true, userId: true },
  });
  if (!event) redirect('/events');
  const recipients = await selectEventUpdateRecipients(eventId, event.userId);

  await prisma.event.delete({ where: { id: eventId } });

  // Best-effort EVENT_CANCELLED fan-out (opt-out respected).
  await notifyEventCancelled({ eventId, event, recipients });

  revalidatePath('/events');
  revalidatePath('/notifications');
  redirect('/events');
}
