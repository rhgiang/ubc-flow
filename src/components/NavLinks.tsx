'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuthOverlay } from '@/components/AuthOverlayContext';
import { useUnsavedChanges } from '@/components/UnsavedChangesContext';

const BASE =
  'rounded-full border px-4 py-2 text-sm font-medium transition duration-150 ease-out hover:scale-[1.02] active:scale-100';
const INACTIVE = 'border-border text-foreground hover:bg-surface-muted';
const ACTIVE = 'border-brand bg-brand text-brand-foreground';

type NavItem = { href: string; label: string } | { href?: undefined; label: string; onClick: () => void };

export default function NavLinks({ loggedIn }: { loggedIn: boolean }) {
  const pathname = usePathname();
  const router = useRouter();
  const { open } = useAuthOverlay();
  const { confirmLeave } = useUnsavedChanges();

  const items: NavItem[] = [
    { href: '/', label: 'Home' },
    { href: '/explore', label: 'Explore' },
    // Logged out, this never navigates to /schedule (which would just
    // hard-redirect to /login) — it opens the same login panel in place.
    loggedIn
      ? { href: '/schedule', label: 'Schedules' }
      : { label: 'Schedules', onClick: () => open('login') },
    // Always reads "Account", whether or not you're signed in.
    loggedIn
      ? { href: '/onboarding', label: 'Account' }
      : { label: 'Account', onClick: () => open('login') },
  ];

  return (
    <div className="flex items-center gap-1">
      {items.map((item) => {
        const active =
          item.href !== undefined &&
          (item.href === '/' ? pathname === '/' : pathname.startsWith(item.href));
        const className = `${BASE} ${active ? ACTIVE : INACTIVE}`;
        return item.href !== undefined ? (
          <Link
            key={item.label}
            href={item.href}
            className={className}
            onNavigate={(e) => {
              // The dialog is async where confirm() was blocking: block this
              // navigation, and re-run it via the router if the student
              // chooses to leave.
              if (!confirmLeave(() => router.push(item.href!))) e.preventDefault();
            }}
          >
            {item.label}
          </Link>
        ) : (
          <button key={item.label} type="button" onClick={item.onClick} className={className}>
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
