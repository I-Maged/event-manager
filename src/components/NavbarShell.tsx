'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useId, useRef, useState } from 'react';

type NavbarShellProps = {
  brand: React.ReactNode;
  auth: React.ReactNode;
  children: React.ReactNode;
};

function MenuIcon({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-6 w-6"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <line
        x1="4"
        y1="7"
        x2="20"
        y2="7"
        className={`origin-center [transform-box:fill-box] transition-transform duration-200 ease-out ${
          open ? 'translate-y-[5px] rotate-45' : ''
        }`}
      />
      <line
        x1="4"
        y1="12"
        x2="20"
        y2="12"
        className={`origin-center [transform-box:fill-box] transition-transform duration-200 ease-out ${
          open ? 'opacity-0' : ''
        }`}
      />
      <line
        x1="4"
        y1="17"
        x2="20"
        y2="17"
        className={`origin-center [transform-box:fill-box] transition-transform duration-200 ease-out ${
          open ? '-translate-y-[5px] -rotate-45' : ''
        }`}
      />
    </svg>
  );
}

/**
 * Owns the responsive navbar layout: a hamburger + full-width dropdown panel
 * below `lg`, and a single inline row at `lg`+. The link tree is passed in as
 * children so it is server-rendered exactly once (no duplicate session reads).
 */
export function NavbarShell({ brand, auth, children }: NavbarShellProps) {
  const panelId = useId();
  const pathname = usePathname();
  // Null means closed; otherwise the route the drawer was opened on. Deriving
  // openness from the pathname closes the drawer on navigation without an
  // effect.
  const [openPath, setOpenPath] = useState<string | null>(null);
  const open = openPath === pathname;
  const close = () => setOpenPath(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpenPath(null);
        buttonRef.current?.focus();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);

  return (
    <div className="relative">
      <div className="flex h-16 items-center justify-between gap-4">
        {brand}
        <button
          type="button"
          ref={buttonRef}
          onClick={() => setOpenPath((current) => (current === pathname ? null : pathname))}
          aria-expanded={open}
          aria-controls={panelId}
          aria-label={open ? 'Close menu' : 'Open menu'}
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-foreground transition-colors hover:bg-indigo-50 hover:text-primary lg:hidden"
        >
          <MenuIcon open={open} />
        </button>

        <div
          id={panelId}
          onClick={(event) => {
            // Covers taps on the current route too, where pathname never changes.
            if ((event.target as Element).closest('a[href]')) close();
          }}
          className={`${
            open ? 'block' : 'hidden'
          } absolute right-0 top-16 z-40 w-72 max-w-[calc(100vw-2rem)] rounded-xl border border-border bg-surface p-3 shadow-lg lg:static lg:flex lg:w-auto lg:max-w-none lg:flex-1 lg:items-center lg:gap-6 lg:rounded-none lg:border-0 lg:bg-transparent lg:p-0 lg:shadow-none`}
        >
          <div className="flex flex-col gap-1 lg:flex-1 lg:flex-row lg:items-center lg:justify-center lg:gap-6">
            {children}
          </div>
          <div className="mt-3 flex flex-col gap-2 border-t border-border pt-3 lg:mt-0 lg:shrink-0 lg:flex-row lg:items-center lg:gap-3 lg:border-0 lg:pt-0">
            {auth}
          </div>
        </div>
      </div>
    </div>
  );
}
