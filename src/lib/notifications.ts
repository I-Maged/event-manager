import { prisma } from '@/db';
import type { NotificationType } from '@/generated/prisma';

export type NotificationRow = {
  id: string;
  type: NotificationType;
  title: string;
  body: string | null;
  eventId: string | null;
  readAt: Date | null;
  createdAt: Date;
  event: { id: string; title: string; date: Date } | null;
};

/** Unread notification count for the navbar bell (0 when signed out). */
export async function getUnreadCount(userId: string): Promise<number> {
  if (!userId) return 0;
  return prisma.notification.count({
    where: { userId, readAt: null },
  });
}

/** Recipient's notifications, newest first. Event may be null (cancelled). */
export async function getNotifications(
  userId: string,
  limit = 30,
): Promise<NotificationRow[]> {
  const take = Math.min(Math.max(limit, 1), 100);
  if (!userId) return [];
  return prisma.notification.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take,
    select: {
      id: true,
      type: true,
      title: true,
      body: true,
      eventId: true,
      readAt: true,
      createdAt: true,
      event: { select: { id: true, title: true, date: true } },
    },
  });
}

export type NotifyInput = {
  userId: string;
  eventId: string | null;
  type: NotificationType;
  title: string;
  body?: string;
};

/** Single createMany fan-out for triggers. No-op when empty. */
export async function notifyUsers(items: NotifyInput[]): Promise<void> {
  if (items.length === 0) return;
  await prisma.notification.createMany({
    data: items.map((item) => ({
      userId: item.userId,
      eventId: item.eventId,
      type: item.type,
      title: item.title,
      body: item.body ?? null,
    })),
  });
}
