'use client';

import Link from 'next/link';
import { useSyncExternalStore } from 'react';
import { CONTACT_EMAIL } from '@/lib/version';

/**
 * Site footer: a frosted capsule of links floating on the sky - the nav bar's
 * sibling at the foot of the page (.sky-capsule / .capsule-chip in globals.css
 * handle glass, reduced transparency, and the plain modes).
 *
 * On a page that scrolls it stays hidden until you scroll, so the first view is
 * content with nothing competing at the bottom edge; on one that doesn't, it is
 * simply there. Read through useSyncExternalStore rather than an effect, so the
 * server renders the hidden state and the client settles it on the first paint.
 *
 * Extra bottom padding on phones keeps it clear of the floating theme/sky
 * buttons pinned to a bottom corner.
 *
 * The chips are their natural 36px on phones, not the 44 they were forced to:
 * 44 is Apple's and Google's guidance for a primary control, WCAG 2.2's own
 * floor is 24, and applying 44 to every chip on the site left the secondary
 * chrome as visually heavy as the actions.
 */
function subscribe(onChange: () => void) {
  window.addEventListener('scroll', onChange, { passive: true });
  window.addEventListener('resize', onChange);
  return () => {
    window.removeEventListener('scroll', onChange);
    window.removeEventListener('resize', onChange);
  };
}

/**
 * A page that cannot scroll shows the footer outright - body is `h-screen`
 * and the content column is `flex-1`, so a short page like the home hero fits
 * the viewport exactly and no amount of waiting would ever reveal it.
 */
function shown(): boolean {
  return (
    document.documentElement.scrollHeight <= window.innerHeight + 4 || window.scrollY > 24
  );
}

export default function Footer() {
  const scrolled = useSyncExternalStore(subscribe, shown, () => false);

  return (
    // inert alongside aria-hidden: hidden-from-screen-readers content whose
    // links stay in the tab order is a WCAG failure - a keyboard user tabs
    // into buttons a screen reader insists are not there. inert removes them
    // from the tab order for exactly as long as they are invisible.
    <footer
      aria-hidden={!scrolled}
      inert={!scrolled}
      className={`sky-footer relative z-10 pb-24 pt-12 text-center transition-all duration-300 ease-out motion-reduce:transition-none sm:pb-10 ${
        scrolled ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-3 opacity-0'
      }`}
    >
      <nav className="sky-capsule mx-auto flex w-fit max-w-full flex-wrap items-center justify-center gap-1 p-1.5 text-[0.875rem] font-medium">
        <Link href="/about" className="capsule-chip px-4 py-2">
          About
        </Link>
        <Link href="/privacy" className="capsule-chip px-4 py-2">
          Privacy
        </Link>
        <Link href="/terms" className="capsule-chip px-4 py-2">
          Terms
        </Link>
        <a
          href={`mailto:${CONTACT_EMAIL}`}
          className="capsule-chip px-4 py-2"
        >
          Contact
        </a>
        <a
          href="https://ubcgrades.com"
          target="_blank"
          rel="noopener noreferrer"
          className="capsule-chip whitespace-nowrap px-4 py-2"
        >
          Grade data: UBC PAIR
        </a>
      </nav>
      <p className="mt-5 text-xs">
        © 2026 UBC Flow ·{' '}
        <span className="whitespace-nowrap">Built by a student, not affiliated with UBC</span>
      </p>
    </footer>
  );
}
