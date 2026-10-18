'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

type NavLinkProps = {
  href: string;
  children: React.ReactNode;
  /** Accessible name override, e.g. to include an unread count. */
  ariaLabel?: string;
};

/**
 * Navbar link that marks itself as current. Works as both a stacked drawer
 * entry (mobile) and an inline desktop entry — styling lives in the
 * `.nav-link` component class, keyed off `aria-current`.
 */
export function NavLink({ href, children, ariaLabel }: NavLinkProps) {
  const pathname = usePathname();
  const isActive = pathname === href || pathname.startsWith(`${href}/`);

  return (
    <Link
      href={href}
      aria-label={ariaLabel}
      aria-current={isActive ? 'page' : undefined}
      className="nav-link"
    >
      {children}
    </Link>
  );
}
