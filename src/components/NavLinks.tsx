'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import { useAuthOverlay } from '@/components/AuthOverlayContext';
import { useUnsavedChanges } from '@/components/UnsavedChangesContext';

const BASE =
  'rounded-full border px-4 py-2 text-sm font-medium transition duration-150 ease-out hover:scale-[1.02] active:scale-100';
const INACTIVE = 'border-border text-foreground hover:bg-surface-muted';
const ACTIVE = 'border-brand bg-brand text-brand-foreground';

// The menu rows are their own shape: full width, no pill, and tall enough to
// be a real touch target. 44px is the floor both Apple and Google publish, and
// the desktop pill at py-2 is 36.
const ROW = 'block w-full rounded-xl px-4 py-3 text-left text-base font-medium';

type NavItem = { href: string; label: string } | { href?: undefined; label: string; onClick: () => void };

export default function NavLinks({ loggedIn }: { loggedIn: boolean }) {
  const pathname = usePathname();
  const { open } = useAuthOverlay();
  const router = useRouter();
  const { isDirty, askToLeave } = useUnsavedChanges();
  const [menuOpen, setMenuOpen] = useState(false);

  const items: NavItem[] = [
    { href: '/', label: 'Home' },
    { href: '/explore', label: 'Explore' },
    // /schedule itself handles signed-out visitors (browse freely; building
    // or importing prompts sign-in), so this is a plain link either way.
    // This replaced an older login gate here — the page owns that decision
    // now, and the nav should not second-guess it.
    { href: '/schedule', label: 'Schedules' },
    // Guidance needs no account either: the roadmap for a student starting
    // fresh is useful on its own, and is the page's best argument for signing
    // in. Personalisation is what login adds, not access.
    { href: '/guidance', label: 'Guidance' },
    // Always reads "Account", whether or not you're signed in.
    loggedIn
      ? { href: '/onboarding', label: 'Account' }
      : { label: 'Account', onClick: () => open('login') },
  ];

  const isActive = (item: NavItem) =>
    item.href !== undefined &&
    (item.href === '/' ? pathname === '/' : pathname.startsWith(item.href));

  /** One item, drawn either as a desktop pill or as a menu row. */
  function render(item: NavItem, shape: 'pill' | 'row') {
    const active = isActive(item);
    const className =
      shape === 'pill'
        ? `${BASE} ${active ? ACTIVE : INACTIVE}`
        : `${ROW} ${active ? ACTIVE : 'text-foreground hover:bg-surface-muted'}`;

    return item.href !== undefined ? (
      <Link
        key={item.label}
        href={item.href}
        className={className}
        aria-current={active ? 'page' : undefined}
        onNavigate={(e) => {
          // The dialog cannot answer in time to let this navigation through,
          // so it is always cancelled and re-issued on confirm. onNavigate
          // fires only for client-side navigations, so a cmd-click opening a
          // new tab never reaches here and is left alone.
          if (!isDirty()) return;
          e.preventDefault();
          askToLeave(() => router.push(item.href));
        }}
        // Client-side navigation keeps this component mounted, so the menu
        // would still be hanging open over the page it just moved to.
        onClick={() => setMenuOpen(false)}
      >
        {item.label}
      </Link>
    ) : (
      <button
        key={item.label}
        type="button"
        onClick={() => {
          setMenuOpen(false);
          item.onClick();
        }}
        className={className}
      >
        {item.label}
      </button>
    );
  }

  return (
    <>
      {/*
        Five pills plus the wordmark need 602px and a phone gives 390. They
        did not wrap or scroll — they overflowed the document, which made
        EVERY page on the site horizontally scrollable and pushed the Account
        pill, the one control a signed-out visitor needs, off the right edge.
        Below sm: the same five live in a menu instead.
      */}
      <div className="hidden items-center gap-2 sm:flex">
        {items.map((item) => render(item, 'pill'))}
      </div>

      <div
        className="relative sm:hidden"
        onKeyDown={(e) => {
          if (e.key === 'Escape') setMenuOpen(false);
        }}
      >
        <button
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          aria-expanded={menuOpen}
          aria-label={menuOpen ? 'Close menu' : 'Open menu'}
          className={`${BASE} ${INACTIVE} flex h-11 w-11 items-center justify-center !px-0`}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-5 w-5">
            {menuOpen ? (
              <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
            ) : (
              <path d="M4 7h16M4 12h16M4 17h16" strokeLinecap="round" />
            )}
          </svg>
        </button>

        {menuOpen && (
          <>
            {/* Catches the tap that dismisses the menu. Sits under the panel
                but over the page, so the first tap outside closes rather than
                activating whatever it landed on. */}
            <div
              className="fixed inset-0 -z-10"
              aria-hidden
              onClick={() => setMenuOpen(false)}
            />
            <div className="absolute right-0 top-full z-50 mt-2 w-56 rounded-card border border-border bg-surface p-2 shadow-lg">
              {items.map((item) => render(item, 'row'))}
            </div>
          </>
        )}
      </div>
    </>
  );
}
