'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuthOverlay } from '@/components/AuthOverlayContext';
import { useUnsavedChanges } from '@/components/UnsavedChangesContext';

const BASE =
  'rounded-full border px-4 py-2 text-sm font-medium transition duration-150 ease-out hover:scale-[1.02] active:scale-100';
const INACTIVE = 'border-border text-foreground hover:bg-surface-muted';
const ACTIVE = 'border-brand bg-brand text-brand-foreground';

type NavItem = { href: string; label: string } | { href?: undefined; label: string; onClick: () => void };

export default function NavLinks({ loggedIn }: { loggedIn: boolean }) {
  const pathname = usePathname();
  const { open } = useAuthOverlay();
  const { confirmLeave } = useUnsavedChanges();

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
              if (!confirmLeave()) e.preventDefault();
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
