'use client';

import { useActionState } from 'react';
import Link from 'next/link';
import { signInWithEmail } from './actions';
import { GoogleSignInButton } from '@/components/GoogleSignInButton';

export default function SignInPage() {
  const [state, formAction, isPending] = useActionState(signInWithEmail, null);

  return (
    <div className="flex justify-center py-12">
      <div className="card w-full max-w-md p-8 space-y-6">
        <h1 className="text-2xl font-bold text-center">Sign in to your account</h1>

        <GoogleSignInButton label="Sign in with Google" />

        <div className="text-center text-sm text-muted">or continue with email</div>

        <form action={formAction} className="space-y-4">
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

          {state?.error && (
            <div className="rounded-md px-3 py-2 text-sm text-red-400 bg-red-950/50 border border-red-900">
              {state.error}
            </div>
          )}

          <button type="submit" disabled={isPending} className="btn-primary w-full">
            {isPending ? 'Signing in...' : 'Sign in'}
          </button>
        </form>

        <p className="text-sm text-center text-muted">
          No account yet?{' '}
          <Link href="/auth/sign-up" className="text-primary hover:underline">
            Sign up
          </Link>
        </p>
      </div>
    </div>
  );
}
