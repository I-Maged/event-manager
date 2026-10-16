import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth/server';
import { formatEventDate } from '@/lib/events';
import { getNotifications } from '@/lib/notifications';
import type { NotificationType } from '@/generated/prisma';
import { MarkAllReadButton, MarkReadButton } from './NotificationButtons';

export const metadata = {
  title: 'Notifications | EventPlanner',
};

// Session-gated: render on demand.
export const instant = false;

const TYPE_LABEL: Record<NotificationType, string> = {
  PROMOTION: 'You got in',
  EVENT_UPDATED: 'Event updated',
  EVENT_CANCELLED: 'Event cancelled',
  COMMENT: 'New comment',
  REMINDER: 'Reminder',
};

export default async function NotificationsPage() {
  const { data: session } = await auth.getSession();
  const userId = session?.user?.id;
  if (!userId) redirect('/auth/sign-in');

  const notifications = await getNotifications(userId);
  const unreadCount = notifications.filter((n) => n.readAt === null).length;

  if (notifications.length === 0) {
    return (
      <div className="space-y-6 max-w-2xl mx-auto">
        <h1 className="text-3xl font-bold">Notifications</h1>
        <div className="card p-8 text-center space-y-4">
          <p className="text-muted">
            Nothing yet. When you get promoted off a wishlist, an event
            changes, or someone comments, it will show up here.
          </p>
          <Link href="/events" className="btn-primary text-sm inline-flex">
            Browse events
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">
          Notifications
          {unreadCount > 0 && (
            <span className="ml-2 text-lg font-semibold text-muted">
              ({unreadCount} unread)
            </span>
          )}
        </h1>
        <MarkAllReadButton disabled={unreadCount === 0} />
      </div>

      <ul className="space-y-3">
        {notifications.map((n) => {
          const isUnread = n.readAt === null;
          return (
            <li
              key={n.id}
              className={`card p-5 space-y-1.5 ${isUnread ? 'border-primary' : ''}`}
            >
              <div className="flex items-start justify-between gap-3">
                <span className="shrink-0 rounded-full border border-border px-2.5 py-1 text-xs text-muted">
                  {TYPE_LABEL[n.type]}
                </span>
                {isUnread ? (
                  <MarkReadButton id={n.id} />
                ) : (
                  <span className="shrink-0 text-xs text-muted">Read</span>
                )}
              </div>
              <p className="font-semibold">{n.title}</p>
              {n.body && <p className="text-sm text-muted">{n.body}</p>}
              {n.event && (
                <p className="text-sm text-muted">
                  {formatEventDate(n.event.date)}
                </p>
              )}
              {n.eventId && (
                <Link
                  href={`/events/${n.eventId}`}
                  className="text-sm text-primary hover:underline inline-flex"
                >
                  View event
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
