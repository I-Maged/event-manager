import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth/server';
import {
  formatEventDate,
  getUserPromotions,
  getUserWishlist,
} from '@/lib/events';
import { DismissPromotionButton, LeaveWishlistButton } from './WishlistButtons';

export const metadata = {
  title: 'Wishlist | EventPlanner',
};

// Session-gated: render on demand.
export const instant = false;

export default async function WishlistPage() {
  const { data: session } = await auth.getSession();
  const userId = session?.user?.id;
  if (!userId) redirect('/auth/sign-in');

  const [wishlist, promotions] = await Promise.all([
    getUserWishlist(userId),
    getUserPromotions(userId),
  ]);

  if (wishlist.length === 0 && promotions.length === 0) {
    return (
      <div className="space-y-6 max-w-2xl mx-auto">
        <h1 className="text-3xl font-bold">Wishlist</h1>
        <div className="card p-8 text-center space-y-4">
          <p className="text-muted">
            Your wishlist is empty. When an event is full, join its wishlist
            and you&apos;ll move up automatically if someone can&apos;t go.
          </p>
          <Link href="/events" className="btn-primary text-sm inline-flex">
            Browse events
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8 max-w-2xl mx-auto">
      <h1 className="text-3xl font-bold">Wishlist</h1>

      {promotions.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-xl font-semibold">You got in!</h2>
          <ul className="space-y-3">
            {promotions.map(({ id, event }) => (
              <li
                key={id}
                className="rounded-md px-4 py-3 text-sm text-green-700 bg-green-50 border border-green-200 space-y-2"
              >
                <div className="flex items-center justify-between gap-3">
                  <Link
                    href={`/events/${event.id}`}
                    className="font-semibold hover:underline"
                  >
                    {event.title}
                  </Link>
                  <DismissPromotionButton eventId={event.id} />
                </div>
                <p>
                  A spot opened up on {formatEventDate(event.date)} — see you
                  at {event.location}!
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {wishlist.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-xl font-semibold">Waiting for a spot</h2>
          <ul className="space-y-3">
            {wishlist.map((entry) => (
              <li key={entry.id} className="card p-5 space-y-1.5">
                <div className="flex items-start justify-between gap-3">
                  <Link
                    href={`/events/${entry.event.id}`}
                    className="font-semibold text-primary hover:underline"
                  >
                    {entry.event.title}
                  </Link>
                  <span className="shrink-0 rounded-full border border-border px-2.5 py-1 text-xs text-muted">
                    #{entry.waitlistPosition ?? '–'} on wishlist
                  </span>
                </div>
                <p className="text-sm text-muted">
                  {formatEventDate(entry.event.date)} · {entry.event.location}
                </p>
                <LeaveWishlistButton eventId={entry.event.id} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
