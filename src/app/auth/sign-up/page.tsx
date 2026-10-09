'use client';

import { useActionState } from 'react';
import Link from 'next/link';
import { signUpWithEmail } from './actions';
import { GoogleSignInButton } from '@/components/GoogleSignInButton';

export default function SignUpPage() {
  const [state, formAction, isPending] = useActionState(signUpWithEmail, null);

  return (
    <div className="flex justify-center py-12">
      <div className="card w-full max-w-md p-8 space-y-6">
        <h1 className="text-2xl font-bold text-center">Create new account</h1>

        <GoogleSignInButton label="Sign up with Google" />

        <div className="text-center text-sm text-muted">or continue with email</div>

        <form action={formAction} className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="name" className="block text-sm font-medium">
              Name
            </label>
            <input
              id="name"
              name="name"
              type="text"
              required
              placeholder="John Doe"
              className="input-field"
            />
          </div>

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
              minLength={8}
              placeholder="********"
              className="input-field"
            />
          </div>

          {state?.error && (
            <div className="alert-error">
              {state.error}
            </div>
          )}

          <button type="submit" disabled={isPending} className="btn-primary w-full">
            {isPending ? 'Creating account...' : 'Create Account'}
          </button>
        </form>

        <p className="text-sm text-center text-muted">
          Already have an account?{' '}
          <Link href="/auth/sign-in" className="text-primary hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
