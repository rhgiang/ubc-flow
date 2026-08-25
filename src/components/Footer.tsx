import Link from 'next/link';

/**
 * Site footer: a solid UBC-navy band grounding the page — the nav bar's
 * anchor at the other end. bg-brand/text-brand-foreground track every
 * theme, including both high-contrast modes where brand inverts.
 *
 * Extra bottom padding on phones keeps the links clear of the floating
 * theme/sky buttons pinned to the bottom-left corner.
 */
export default function Footer() {
  return (
    <footer className="relative z-10 bg-brand text-brand-foreground">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-x-8 gap-y-4 px-6 pb-24 pt-8 sm:pb-8">
        <p className="text-[13px] text-brand-foreground/80">
          © 2026 UBC Flow ·{' '}
          <span className="whitespace-nowrap">Built by students, not affiliated with UBC</span>
        </p>
        <nav className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm font-medium">
          <Link href="/about" className="py-1 text-brand-foreground/85 hover:text-brand-foreground hover:underline">
            About
          </Link>
          <Link href="/privacy" className="py-1 text-brand-foreground/85 hover:text-brand-foreground hover:underline">
            Privacy
          </Link>
          <Link href="/terms" className="py-1 text-brand-foreground/85 hover:text-brand-foreground hover:underline">
            Terms
          </Link>
          <a
            href="https://ubcgrades.com"
            target="_blank"
            rel="noopener noreferrer"
            className="whitespace-nowrap py-1 text-brand-foreground/85 hover:text-brand-foreground hover:underline"
          >
            Grade data: UBC PAIR
          </a>
        </nav>
      </div>
    </footer>
  );
}
