'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { prisma } from '@/db';
import { auth } from '@/lib/auth/server';
import { parseEventForm } from '@/lib/event-validation';
import { resolveOrganizerName } from '@/lib/events';
import { notifyUsers } from '@/lib/notifications';
import { lockEvent, notifyPromotions, promoteFromWishlist } from '@/lib/rsvp';
import { enforceRateLimit } from '@/lib/rate-limit';
import { formatEventDate } from '@/lib/time';

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

  // Capacity shrink and the write that stores it must be atomic with respect
  // to concurrent RSVP mutations, so they share the per-event advisory lock
  // used by upsertRsvpCore/cancelRsvpCore. Without it, the GOING count read
  // here can go stale before the update lands and the cap can be stored
  // below the number of guests already going.
  const outcome = await prisma.$transaction(
    async (tx) => {
      await lockEvent(tx, eventId);

      // Prevent shrinking capacity below the current GOING count.
      if (parsed.data.maxAttendees !== null) {
        const going = await tx.rSVP.count({
          where: { eventId, status: 'GOING' },
        });
        if (parsed.data.maxAttendees < going) {
          return {
            ok: false as const,
            error: `Capacity cannot be below the ${going} guests already going.`,
          };
        }
      }

      // Pre-update snapshot for the EVENT_UPDATED diff below.
      const before = await tx.event.findUnique({
        where: { id: eventId },
        select: {
          title: true,
          date: true,
          location: true,
          timeZone: true,
          userId: true,
          maxAttendees: true,
        },
      });
      if (!before) return { ok: false as const, error: 'Event not found.' };

      // Preserve the stored zone when the organizer did not move the wall
      // clock. Legacy rows have `timeZone = null`, while the edit form seeds
      // its hidden field with the *display* fallback (APP_TIME_ZONE); writing
      // that fallback on a no-op save would silently shift the event's shown
      // time. `datetime-local` only submits minutes, so compare whole minutes.
      const sameWallClock =
        Math.floor(parsed.data.date.getTime() / 60_000) ===
        Math.floor(before.date.getTime() / 60_000);
      const timeZone = sameWallClock ? before.timeZone : parsed.data.timeZone;

      await tx.event.update({
        where: { id: eventId },
        data: { ...parsed.data, timeZone, organizerName },
      });

      // A raised cap frees seats immediately: promote inside the same locked
      // transaction so the stored capacity and the wishlist cannot disagree.
      const newCap = parsed.data.maxAttendees;
      const raisedCap =
        newCap !== null &&
        (before.maxAttendees === null || newCap > before.maxAttendees);
      const promoted =
        raisedCap && newCap !== null
          ? await promoteFromWishlist(tx, eventId, newCap)
          : [];

      return { ok: true as const, before, promoted, timeZone };
    },
    { timeout: 15_000 },
  );

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
  const changeLines: string[] = [];
  if (parsed.data.title !== before.title) {
    changeLines.push(`Title is now “${parsed.data.title}”`);
  }
  if (parsed.data.location !== before.location) {
    changeLines.push(`Location is now ${parsed.data.location}`);
  }
  if (parsed.data.date.getTime() !== before.date.getTime()) {
    changeLines.push(`Date is now ${formatEventDate(parsed.data.date, timeZone)}`);
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
    select: { title: true, date: true, timeZone: true, location: true, userId: true },
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
          body: `${formatEventDate(event.date, event.timeZone)} at ${event.location} will not take place.`,
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
