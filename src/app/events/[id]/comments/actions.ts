'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { prisma } from '@/db';
import { auth } from '@/lib/auth/server';
import { canViewEvent, resolveOrganizerName } from '@/lib/events';
import { MAX_COMMENT_LENGTH } from '@/lib/comments';
import { enforceRateLimit } from '@/lib/rate-limit';
const NOTIFY_RECIPIENT_CAP = 20;

async function requireUser(): Promise<{
  userId: string;
  authorName: string | null;
}> {
  const { data: session } = await auth.getSession();
  const userId = session?.user?.id;
  if (!userId) redirect('/auth/sign-in');
  return { userId, authorName: resolveOrganizerName(session?.user) };
}

async function requireUserId(): Promise<string> {
  const { data: session } = await auth.getSession();
  const userId = session?.user?.id;
  if (!userId) redirect('/auth/sign-in');
  return userId;
}

export type AddCommentResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

export async function addComment(
  eventId: string,
  body: string,
): Promise<AddCommentResult> {
  const { userId, authorName } = await requireUser();
  const trimmed = body.trim();
  if (trimmed.length === 0) return { ok: false, error: 'Comment is required.' };
  if (trimmed.length > MAX_COMMENT_LENGTH) {
    return { ok: false, error: 'Comment must be 1000 characters or fewer.' };
  }

  const limited = await enforceRateLimit('comment', userId);
  if (limited) return limited;

  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) return { ok: false, error: 'Event not found.' };
  if (!(await canViewEvent(event, userId))) {
    return { ok: false, error: 'Event not found.' };
  }
  if (event.date < new Date()) {
    return { ok: false, error: 'This event has ended.' };
  }

  const comment = await prisma.comment.create({
    data: { eventId, userId, authorName, body: trimmed },
    select: { id: true },
  });

  // Best-effort fan-out: comment succeeds even if notifications fail.
  try {
    const prior = await prisma.comment.findMany({
      where: { eventId, NOT: { userId } },
      select: { userId: true },
      distinct: ['userId'],
      take: NOTIFY_RECIPIENT_CAP,
    });
    const recipients = new Set<string>();
    if (event.userId !== userId) recipients.add(event.userId);
    for (const row of prior) {
      if (row.userId !== userId) recipients.add(row.userId);
      if (recipients.size >= NOTIFY_RECIPIENT_CAP) break;
    }
    if (recipients.size > 0) {
      await prisma.notification.createMany({
        data: [...recipients].map((recipientId) => ({
          userId: recipientId,
          eventId,
          type: 'COMMENT' as const,
          title: `New comment on ${event.title}`,
          body: trimmed.slice(0, 140),
        })),
      });
    }
  } catch (error) {
    console.error('comment notify fan-out failed', { eventId, error });
  }

  revalidatePath(`/events/${eventId}`);
  return { ok: true, id: comment.id };
}

export async function deleteComment(
  commentId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const userId = await requireUserId();
  const limited = await enforceRateLimit('commentDelete', userId);
  if (limited) return limited;

  const comment = await prisma.comment.findUnique({
    where: { id: commentId },
    select: { id: true, userId: true, eventId: true },
  });
  if (!comment) return { ok: false, error: 'Comment not found.' };
  const event = await prisma.event.findUnique({
    where: { id: comment.eventId },
    select: { userId: true },
  });
  if (!event) return { ok: false, error: 'Comment not found.' };
  if (comment.userId !== userId && event.userId !== userId) {
    return { ok: false, error: 'You cannot delete this comment.' };
  }
  await prisma.comment.delete({ where: { id: comment.id } });
  revalidatePath(`/events/${comment.eventId}`);
  return { ok: true };
}
