'use client';

import Link from 'next/link';
import { useSyncExternalStore } from 'react';
import { CONTACT_EMAIL, REPO_URL } from '@/lib/version';

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
          href={REPO_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="capsule-chip inline-flex items-center gap-1.5 px-4 py-2"
        >
          {/* The GitHub mark, inline rather than an icon dependency: it is one
              path and the footer is the only place it appears. */}
          <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden>
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38
              0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01
              1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95
              0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27
              2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82
              2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0
              .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
          </svg>
          Source
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
