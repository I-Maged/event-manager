import { auth } from "@/lib/auth/server";
import { getUnreadCount } from "@/lib/notifications";
import { NavLink } from "./NavLink";

/**
 * Server-rendered auth links for the navbar. Single server source of truth:
 * one getSession() + one getUnreadCount() call. Renders nothing when signed
 * out. Wrapped in its own <Suspense> by Navbar so the static shell can
 * prerender while this streams in.
 */
export async function NavbarSessionLinks() {
  const { data: session } = await auth.getSession();
  const userId = session?.user?.id;
  if (!userId) return null;

  const unread = await getUnreadCount(userId);
  const label = unread > 9 ? "9+" : String(unread);

  return (
    <>
      <NavLink href="/account">Account</NavLink>
      <NavLink href="/my-events">My events</NavLink>
      <NavLink href="/wishlist">Wishlist</NavLink>
      <NavLink
        href="/notifications"
        ariaLabel={
          unread > 0
            ? `Notifications, ${unread} unread`
            : "Notifications, no unread"
        }
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
      </NavLink>
    </>
  );
}
