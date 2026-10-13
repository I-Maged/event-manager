'use client';

import Link from 'next/link';
import { authClient } from '@/lib/auth/client';

export function NavbarSessionClient() {
  const { data: session, isPending } = authClient.useSession();
  const user = session?.user;

  if (isPending || !user) return null;

  return (
    <>
      <Link
        href="/account"
        className="text-foreground hover:text-primary px-3 py-2 rounded-md text-sm font-medium transition-colors"
      >
        Account
      </Link>
      <Link
        href="/my-events"
        className="text-foreground hover:text-primary px-3 py-2 rounded-md text-sm font-medium transition-colors"
      >
        My events
      </Link>
      <Link
        href="/wishlist"
        className="text-foreground hover:text-primary px-3 py-2 rounded-md text-sm font-medium transition-colors"
      >
        Wishlist
      </Link>
    </>
  );
}
