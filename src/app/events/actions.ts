'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { prisma } from '@/db';
import type { RSVPStatus } from '@/generated/prisma';
import { auth } from '@/lib/auth/server';

const SETTABLE_STATUSES = ['GOING', 'MAYBE', 'NOT_GOING'] as const;
export type SettableStatus = (typeof SETTABLE_STATUSES)[number];

export type SetRsvpResult =
  | { ok: true; status: RSVPStatus; waitlistPosition: number | null }
  | { ok: false; error: string };

async function requireUserId(): Promise<string> {
  const { data: session } = await auth.getSession();
  const userId = session?.user?.id;
  if (!userId) redirect('/auth/sign-in');
  return userId;
}

/**
 * Upsert the caller's RSVP. GOING past a full cap becomes WAITLISTED.
 * Runs in a transaction so concurrent GOING clicks cannot overbook.
 * After freeing a GOING slot, the oldest WAITLISTED entry is promoted.
 */
export async function setRsvp(
  eventId: string,
  status: SettableStatus,
): Promise<SetRsvpResult> {
  if (!SETTABLE_STATUSES.includes(status)) {
    return { ok: false, error: 'Invalid RSVP status.' };
  }
  const userId = await requireUserId();

  const result = await prisma.$transaction(async (tx) => {
    const event = await tx.event.findUnique({ where: { id: eventId } });
    if (!event) return { ok: false as const, error: 'Event not found.' };
    if (event.date < new Date())
      return { ok: false as const, error: 'This event has ended.' };

    const existing = await tx.rSVP.findUnique({
      where: { userId_eventId: { userId, eventId } },
    });

    let target: RSVPStatus = status;
    if (status === 'GOING' && event.maxAttendees != null) {
      const going = await tx.rSVP.count({
        where: { eventId, status: 'GOING' },
      });
      const alreadyGoing = existing?.status === 'GOING';
      if (!alreadyGoing && going >= event.maxAttendees) {
        target = 'WAITLISTED';
      }
    }

    const row = await tx.rSVP.upsert({
      where: { userId_eventId: { userId, eventId } },
      create: { eventId, userId, status: target },
      update: { status: target },
      select: { id: true, status: true, createdAt: true },
    });

    // Promote oldest waitlisted entries while GOING slots are free
    // (covers leaving the GOING pool and capacity increases via edit).
    if (event.maxAttendees != null) {
      let going = await tx.rSVP.count({
        where: { eventId, status: 'GOING' },
      });
      while (going < event.maxAttendees) {
        const next = await tx.rSVP.findFirst({
          where: { eventId, status: 'WAITLISTED' },
          orderBy: { createdAt: 'asc' },
          select: { id: true },
        });
        if (!next) break;
        await tx.rSVP.update({
          where: { id: next.id },
          data: { status: 'GOING' },
        });
        going += 1;
      }
    }

    let waitlistPosition: number | null = null;
    const finalRow =
      row.id && target === 'WAITLISTED'
        ? await tx.rSVP.findUnique({
            where: { id: row.id },
            select: { status: true, createdAt: true },
          })
        : null;
    // Re-read: promotion above may have moved this user to GOING.
    const finalStatus = finalRow?.status ?? target;
    if (finalStatus === 'WAITLISTED' && finalRow) {
      const ahead = await tx.rSVP.count({
        where: {
          eventId,
          status: 'WAITLISTED',
          createdAt: { lt: finalRow.createdAt },
        },
      });
      waitlistPosition = ahead + 1;
    }

    return { ok: true as const, status: finalStatus, waitlistPosition };
  });

  if (result.ok) {
    revalidatePath(`/events/${eventId}`);
    revalidatePath('/events');
  }
  return result;
}

/** Remove the caller's RSVP entirely, promoting the waitlist if needed. */
export async function cancelRsvp(
  eventId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const userId = await requireUserId();

  const result = await prisma.$transaction(async (tx) => {
    const event = await tx.event.findUnique({ where: { id: eventId } });
    if (!event) return { ok: false as const, error: 'Event not found.' };

    await tx.rSVP.deleteMany({ where: { eventId, userId } });

    if (event.maxAttendees != null) {
      let going = await tx.rSVP.count({
        where: { eventId, status: 'GOING' },
      });
      while (going < event.maxAttendees) {
        const next = await tx.rSVP.findFirst({
          where: { eventId, status: 'WAITLISTED' },
          orderBy: { createdAt: 'asc' },
          select: { id: true },
        });
        if (!next) break;
        await tx.rSVP.update({
          where: { id: next.id },
          data: { status: 'GOING' },
        });
        going += 1;
      }
    }
    return { ok: true as const };
  });

  if (result.ok) {
    revalidatePath(`/events/${eventId}`);
    revalidatePath('/events');
  }
  return result;
}
