'use client';

import { useRouter } from 'next/navigation';
import { authClient } from '@/lib/auth/client';
import { useActionFeedback } from '@/lib/useActionFeedback';

export function SignOutButton() {
  const router = useRouter();
  const { pending, error, setError, run } = useActionFeedback();

  async function handleSignOut() {
    const result = await run(() => authClient.signOut());
    if (!result) return;
    if (result.error) {
      setError(result.error.message || 'Sign out failed. Please retry.');
      return;
    }
    router.push('/');
    router.refresh();
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={handleSignOut}
        disabled={pending}
        className="btn-danger text-sm"
      >
        {pending ? 'Signing out...' : 'Sign out'}
      </button>
      {error && (
        <span role="alert" className="text-xs text-red-700">
          {error}
        </span>
      )}
    </span>
  );
}
