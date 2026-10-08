import Link from "next/link";
import { Suspense } from "react";
import { auth } from "@/lib/auth/server";
import { SignOutButton } from "./SignOutButton";

async function NavbarSession() {
  const { data: session } = await auth.getSession();
  const user = session?.user;

  return (
    <>
      {user && (
        <Link
          href="/account"
          className="text-foreground hover:text-primary px-3 py-2 rounded-md text-sm font-medium transition-colors"
        >
          Account
        </Link>
      )}
    </>
  );
}

async function NavbarAuth() {
  const { data: session } = await auth.getSession();
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

const Navbar = () => {
  return (
    <nav className="bg-slate-800 border-b border-slate-700 shadow-lg">
      <div className="max-w-7xl mx-auto px-4">
        <div className="h-16 flex justify-between">
          <div className="flex items-center gap-6">
            <Link href="/" className="text-primary text-xl font-bold">
              EventPlanner
            </Link>
            <Link
              href="/events"
              className="text-foreground hover:text-primary px-3 py-2 rounded-md text-sm font-medium transition-colors"
            >
              Events
            </Link>
            <Suspense fallback={null}>
              <NavbarSession />
            </Suspense>
          </div>

          <div className="hidden md:flex items-center gap-3">
            <Suspense
              fallback={
                <span className="text-sm text-muted">Loading...</span>
              }
            >
              <NavbarAuth />
            </Suspense>
          </div>
        </div>
      </div>
    </nav>
  );
};

export default Navbar;
