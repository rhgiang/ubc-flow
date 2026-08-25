import Link from 'next/link';

/**
 * Site footer: a frosted capsule of links floating on the sky — the nav
 * bar's sibling at the foot of the page (.sky-capsule / .capsule-chip in
 * globals.css handle glass, reduced-transparency, and high-contrast).
 *
 * Extra bottom padding on phones keeps it clear of the floating theme/sky
 * buttons pinned to the bottom-left corner.
 */
export default function Footer() {
  return (
    <footer className="sky-footer relative z-10 pb-24 pt-12 text-center sm:pb-10">
      <nav className="sky-capsule mx-auto flex w-fit max-w-full flex-wrap items-center justify-center gap-1 p-1.5 text-sm font-medium">
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
          href="https://ubcgrades.com"
          target="_blank"
          rel="noopener noreferrer"
          className="capsule-chip whitespace-nowrap px-4 py-2"
        >
          Grade data: UBC PAIR
        </a>
      </nav>
      <p className="mt-5 text-[13px]">
        © 2026 UBC Flow ·{' '}
        <span className="whitespace-nowrap">Built by students, not affiliated with UBC</span>
      </p>
    </footer>
  );
}
