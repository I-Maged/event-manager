'use client';

import Link from 'next/link';
import { useSyncExternalStore } from 'react';
import { authClient } from '@/lib/auth/client';
import { SignOutButton } from './SignOutButton';

function useMounted() {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
}

export function NavbarAuthClient() {
  const { data: session, isPending } = authClient.useSession();
  const mounted = useMounted();

  if (!mounted || isPending) {
    return <span className="px-3 py-2 text-sm text-muted">Loading...</span>;
  }

  const user = session?.user;

  if (user) {
    return (
      <>
        <span className="truncate px-3 py-2 text-sm text-muted lg:max-w-64">
          {user.email}
        </span>
        <SignOutButton />
      </>
    );
  }

  return (
    <>
      <Link href="/auth/sign-in" className="nav-link">
        Sign in
      </Link>
      <Link href="/auth/sign-up" className="btn-primary text-sm">
        Sign up
      </Link>
    </>
  );
}
