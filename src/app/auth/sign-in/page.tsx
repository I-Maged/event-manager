'use client';

import Link from 'next/link';
import { Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { authClient } from '@/lib/auth/client';
import { GoogleSignInButton } from '@/components/GoogleSignInButton';
import { useActionFeedback } from '@/lib/useActionFeedback';

function SignInForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get('next');
  const nextPath =
    next && next.startsWith('/') && !next.startsWith('//') ? next : '/';
  const { pending: isPending, error, setError, run } = useActionFeedback();

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    // Read the form before awaiting: currentTarget is only valid during
    // dispatch.
    const formData = new FormData(e.currentTarget);
    const result = await run(() =>
      authClient.signIn.email({
        email: formData.get('email') as string,
        password: formData.get('password') as string,
      }),
    );
    if (!result) return;
    if (result.error) {
      setError(result.error.message || 'Failed to sign in. Try again');
      return;
    }
    router.push(nextPath);
    router.refresh();
  }

  return (
    <div className="flex justify-center py-12">
      <div className="card w-full max-w-md p-8 space-y-6">
        <h1 className="text-2xl font-bold text-center">Sign in to your account</h1>

        <GoogleSignInButton label="Sign in with Google" />

        <div className="text-center text-sm text-muted">or continue with email</div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="email" className="block text-sm font-medium">
              Email address
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              placeholder="john@example.com"
              className="input-field"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="password" className="block text-sm font-medium">
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              required
              placeholder="********"
              className="input-field"
            />
          </div>

          {error && (
            <div className="alert-error">
              {error}
            </div>
          )}

          <button type="submit" disabled={isPending} className="btn-primary w-full">
            {isPending ? 'Signing in...' : 'Sign in'}
          </button>
        </form>

        <p className="text-sm text-center text-muted">
          No account yet?{' '}
          <Link href="/auth/sign-up" className="text-primary underline hover:underline">
            Sign up
          </Link>
        </p>
      </div>
    </div>
  );
}


export default function Page() {
  return (
    <Suspense fallback={null}>
      <SignInForm />
    </Suspense>
  );
}
