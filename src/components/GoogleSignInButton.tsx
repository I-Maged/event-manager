'use client';

import { authClient } from '@/lib/auth/client';
import { useActionFeedback } from '@/lib/useActionFeedback';

export function GoogleSignInButton({ label = 'Continue with Google' }: { label?: string }) {
  const { pending, error, setError, run } = useActionFeedback();

  async function handleClick() {
    // Land on a middleware-covered route so the proxy exchanges
    // ?neon_auth_session_verifier=… for the session cookie.
    const result = await run(() =>
      authClient.signIn.social({
        provider: 'google',
        callbackURL: '/account',
      }),
    );
    if (!result) return;
    if (result.error) {
      setError(
        result.error.message || 'Google sign-in failed. Is Google enabled in Neon Auth?',
      );
    }
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        className="btn-secondary w-full disabled:opacity-60"
      >
        {pending ? 'Redirecting to Google...' : label}
      </button>
      {error && (
        <div className="alert-error">
          {error}
        </div>
      )}
    </div>
  );
}
