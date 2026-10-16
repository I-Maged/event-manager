import Link from 'next/link';
import { auth } from '@/lib/auth/server';
import { getUnreadCount } from '@/lib/notifications';

/**
 * Server-rendered notification bell for the navbar. Renders nothing when
 * signed out. Count is request-time (no polling v1) — every mutation
 * revalidates, so the bell stays fresh on navigation.
 */
export async function NavbarNotificationsLink() {
  const { data: session } = await auth.getSession();
  const userId = session?.user?.id;
  if (!userId) return null;

  const unread = await getUnreadCount(userId);
  const label = unread > 9 ? '9+' : String(unread);

  return (
    <Link
      href="/notifications"
      aria-label={
        unread > 0
          ? `Notifications, ${unread} unread`
          : 'Notifications, no unread'
      }
      className="relative text-foreground hover:text-primary px-3 py-2 rounded-md text-sm font-medium transition-colors"
    >
      Notifications
      {unread > 0 && (
        <span
          aria-hidden="true"
          className="ml-1.5 inline-flex min-w-5 h-5 items-center justify-center rounded-full bg-primary px-1 text-[11px] font-semibold text-white"
        >
          {label}
        </span>
      )}
    </Link>
  );
}
