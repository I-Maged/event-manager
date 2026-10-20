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
  event: { id: string; title: string; date: Date; timeZone: string | null } | null;
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
      event: { select: { id: true, title: true, date: true, timeZone: true } },
    },
  });
}

/** Rows per page on `/notifications` (older rows must become reachable). */
export const NOTIFICATIONS_PAGE_SIZE = 20;

export type NotificationsPageResult = {
  notifications: NotificationRow[];
  total: number;
  page: number;
  pageCount: number;
};

/**
 * One page of the recipient's notifications, newest first. `requestedPage` is
 * clamped so an out-of-range URL renders the last page instead of an empty
 * screen. The total is the recipient's full count (not the page window).
 */
export async function getNotificationsPage(
  userId: string,
  requestedPage: number,
): Promise<NotificationsPageResult> {
  if (!userId) {
    return { notifications: [], total: 0, page: 1, pageCount: 1 };
  }

  const total = await prisma.notification.count({ where: { userId } });
  const pageCount = Math.max(1, Math.ceil(total / NOTIFICATIONS_PAGE_SIZE));
  const page = Math.min(Math.max(requestedPage, 1), pageCount);

  const notifications = await prisma.notification.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    skip: (page - 1) * NOTIFICATIONS_PAGE_SIZE,
    take: NOTIFICATIONS_PAGE_SIZE,
    select: {
      id: true,
      type: true,
      title: true,
      body: true,
      eventId: true,
      readAt: true,
      createdAt: true,
      event: { select: { id: true, title: true, date: true, timeZone: true } },
    },
  });

  return { notifications, total, page, pageCount };
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

/** Events within this window get a lazy REMINDER when the widget renders. */
export const REMINDER_WINDOW_MS = 48 * 60 * 60 * 1000;
/** Suppress repeat REMINDERs within this window (idempotency key). */
export const REMINDER_DEDUP_MS = 24 * 60 * 60 * 1000;

export type ReminderCandidate = {
  id: string;
  notifyOnUpdate: boolean;
  event: { id: string; title: string; date: Date };
};

/**
 * Lazily write REMINDER notifications for due candidates (cron substitute).
 * Skips opted-out rows, far-future events, and events reminded recently.
 * Never throws: a notify failure must not break the rendering widget.
 */
export async function ensureDueReminders(
  userId: string,
  rows: ReminderCandidate[],
): Promise<void> {
  if (!userId || rows.length === 0) return;
  const now = new Date();
  try {
    const due = rows.filter(
      (row) =>
        row.notifyOnUpdate && row.event.date.getTime() - now.getTime() <= REMINDER_WINDOW_MS,
    );
    for (const row of due) {
      const recent = await prisma.notification.findFirst({
        where: {
          userId,
          eventId: row.event.id,
          type: 'REMINDER',
          createdAt: { gte: new Date(now.getTime() - REMINDER_DEDUP_MS) },
        },
        select: { id: true },
      });
      if (recent) continue;
      await notifyUsers([
        {
          userId,
          eventId: row.event.id,
          type: 'REMINDER',
          title: `Upcoming: ${row.event.title}`,
          body: 'Your event is coming up soon.',
        },
      ]);
    }
  } catch (error) {
    console.error('ensureDueReminders failed', { userId, error });
  }
}
