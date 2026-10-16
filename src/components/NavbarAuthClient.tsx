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
    return <span className="text-sm text-muted">Loading...</span>;
  }

  const user = session?.user;

  if (user) {
    return (
      <>
        <span className="text-sm text-muted">{user.email}</span>
        <SignOutButton />
      </>
    );
  }

  return (
    <>
      <Link
        href="/auth/sign-in"
        className="text-foreground hover:text-primary px-3 py-2 rounded-md text-sm font-medium transition-colors"
      >
        Sign in
      </Link>
      <Link href="/auth/sign-up" className="btn-primary text-sm">
        Sign up
      </Link>
    </>
  );
}
