import Link from "next/link";
import { Suspense } from "react";
import { NavbarAuthClient } from "./NavbarAuthClient";
import { NavbarSessionLinks } from "./NavbarSessionLinks";
import { NavbarShell } from "./NavbarShell";
import { NavLink } from "./NavLink";

const Navbar = () => {
  return (
    <nav className="sticky top-0 z-50 bg-surface/80 border-b border-border shadow-sm backdrop-blur">
      <div className="max-w-7xl mx-auto px-4">
        <NavbarShell
          brand={
            <Link
              href="/"
              className="min-w-0 truncate text-primary text-xl font-bold"
            >
              EventPlanner
            </Link>
          }
          auth={
            <Suspense fallback={<span className="text-sm text-muted">Loading...</span>}>
              <NavbarAuthClient />
            </Suspense>
          }
        >
          <NavLink href="/events">Events</NavLink>
          <Suspense fallback={null}>
            <NavbarSessionLinks />
          </Suspense>
        </NavbarShell>
      </div>
    </nav>
  );
};

export default Navbar;
