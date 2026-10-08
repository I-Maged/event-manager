'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { authClient } from '@/lib/auth/client';

export function SignOutButton() {
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);

  async function handleSignOut() {
    setIsPending(true);
    await authClient.signOut();
    router.push('/');
    router.refresh();
  }

  return (
    <button onClick={handleSignOut} disabled={isPending} className="btn-danger text-sm">
      {isPending ? 'Signing out...' : 'Sign out'}
    </button>
  );
}
