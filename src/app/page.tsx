import Link from "next/link";
import { Suspense } from "react";
import { auth } from "@/lib/auth/server";

async function HomeContent() {
  const { data: session } = await auth.getSession();

  if (session?.user) {
    return (
      <div className="card p-8 text-center space-y-4">
        <h1 className="text-3xl font-bold">
          Welcome back, {session.user.name ?? session.user.email}
        </h1>
        <p className="text-muted">You are signed in as {session.user.email}</p>
        <div className="flex justify-center gap-4">
          <Link href="/account" className="btn-primary">
            Go to account
          </Link>
          <Link href="/events" className="btn-secondary">
            Browse events
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="card p-8 text-center space-y-4">
      <h1 className="text-3xl font-bold">Plan events, manage RSVPs</h1>
      <p className="text-muted">Sign up or sign in to get started.</p>
      <div className="flex justify-center gap-4">
        <Link href="/auth/sign-up" className="btn-primary">
          Sign up
        </Link>
        <Link href="/auth/sign-in" className="btn-secondary">
          Sign in
        </Link>
      </div>
    </div>
  );
}

export default function Home() {
  return (
    <div className="space-y-12">
      <Suspense
        fallback={
          <div className="card p-8 text-center">
            <p className="text-muted">Loading...</p>
          </div>
        }
      >
        <HomeContent />
      </Suspense>
    </div>
  );
}
