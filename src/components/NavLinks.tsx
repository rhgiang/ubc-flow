'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import { useAuthOverlay } from '@/components/AuthOverlayContext';
import { readSignedIn, useSignedIn } from '@/components/use-signed-in';
import { useUnsavedChanges } from '@/components/UnsavedChangesContext';

const BASE =
  'rounded-full border px-4 py-2 text-sm font-medium transition duration-150 ease-out hover:scale-[1.02] active:scale-100';
const INACTIVE = 'border-border text-foreground hover:bg-surface-muted';
const ACTIVE = 'border-brand bg-brand text-brand-foreground';

// The menu rows are their own shape: full width, no pill, and tall enough to
// be a real touch target. 44px is the floor both Apple and Google publish, so
// the row sits exactly on it (min-h-11, no vertical padding) rather than the
// 48 it used to be — the menu shrinks by way of smaller text and a narrower
// panel, never by taking the target under the line.
const ROW =
  'flex min-h-11 w-full items-center rounded-xl px-3 text-left text-sm font-medium';

type NavItem = { href: string; label: string } | { href?: undefined; label: string; onClick: () => void };

export default function NavLinks() {
  const pathname = usePathname();
  const { open } = useAuthOverlay();
  const router = useRouter();
  const { isDirty, askToLeave } = useUnsavedChanges();
  const [menuOpen, setMenuOpen] = useState(false);
  // Resolved in the browser rather than passed from the server: the nav is on
  // every page, and a server-side auth() read forced the WHOLE site into
  // per-request rendering — no page could be served from the CDN. The button
  // says "Account" in both states, so nothing flashes while this loads.
  const loggedIn = useSignedIn();

  const items: NavItem[] = [
    { href: '/', label: 'Home' },
    { href: '/explore', label: 'Explore' },
    // /schedule itself handles signed-out visitors (browse freely; building
    // or importing prompts sign-in), so this is a plain link either way.
    // This replaced an older login gate here — the page owns that decision
    // now, and the nav should not second-guess it.
    { href: '/schedule', label: 'Schedules' },
    { href: '/exams', label: 'Exams' },
    // Guidance needs no account either: the roadmap for a student starting
    // fresh is useful on its own, and is the page's best argument for signing
    // in. Personalisation is what login adds, not access.
    { href: '/guidance', label: 'Guidance' },
    // Always reads "Account", whether or not you're signed in.
    loggedIn
      ? { href: '/onboarding', label: 'Account' }
      : {
          label: 'Account',
          onClick: async () => {
            // Ask every time; never trust the cached answer. loggedIn is read
            // once in a mount effect, so for anyone who has signed in since —
            // through the very overlay this button opens — it still says
            // "signed out". `loggedIn ?? fetch` then short-circuited on that
            // stale false and never re-checked at all, so Account reopened the
            // login form for someone already signed in: the exact thing this
            // check exists to prevent. Only the signed-out branch has this
            // handler, so the fetch costs nothing anyone is waiting on.
            const known = await readSignedIn();
            if (known) router.push('/onboarding');
            else open('login');
          },
        },
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
            {/* w-36, not the old w-56: at 224px the panel covered 57% of a
                393px phone for five one-word labels, the longest of which
                ("Schedules") sets type at 66px. 144 leaves it room to breathe
                and still hands back a third of the width it was taking. */}
            <div className="absolute right-0 top-full z-50 mt-1.5 w-36 rounded-card border border-border bg-surface p-1.5 shadow-lg">
              {items.map((item) => render(item, 'row'))}
            </div>
          </>
        )}
      </div>
    </>
  );
}
