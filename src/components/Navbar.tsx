import Link from "next/link";
import { Suspense } from "react";
import { NavbarAuthClient } from "./NavbarAuthClient";
import { NavbarSessionClient } from "./NavbarSessionClient";
import { NavbarNotificationsLink } from "./NavbarNotificationsLink";

const Navbar = () => {
  return (
    <nav className="bg-surface border-b border-border shadow-sm">
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
              <NavbarSessionClient />
              <NavbarNotificationsLink />
            </Suspense>
          </div>

          <div className="hidden md:flex items-center gap-3">
            <Suspense
              fallback={
                <span className="text-sm text-muted">Loading...</span>
              }
            >
              <NavbarAuthClient />
            </Suspense>
          </div>
        </div>
      </div>
    </nav>
  );
};

export default Navbar;
