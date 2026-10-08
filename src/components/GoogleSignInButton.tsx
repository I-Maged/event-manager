'use client';

import { useState } from 'react';
import { authClient } from '@/lib/auth/client';

export function GoogleSignInButton({ label = 'Continue with Google' }: { label?: string }) {
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setIsPending(true);
    setError(null);
    // Land on a middleware-covered route so the proxy exchanges
    // ?neon_auth_session_verifier=… for the session cookie.
    const { error } = await authClient.signIn.social({
      provider: 'google',
      callbackURL: '/account',
    });
    if (error) {
      setError(error.message || 'Google sign-in failed. Is Google enabled in Neon Auth?');
      setIsPending(false);
    }
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={handleClick}
        disabled={isPending}
        className="btn-secondary w-full disabled:opacity-60"
      >
        {isPending ? 'Redirecting to Google...' : label}
      </button>
      {error && (
        <div className="rounded-md px-3 py-2 text-sm text-red-400 bg-red-950/50 border border-red-900">
          {error}
        </div>
      )}
    </div>
  );
}
