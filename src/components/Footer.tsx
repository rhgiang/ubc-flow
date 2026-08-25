import Link from 'next/link';

/**
 * Site footer: a full-width paper strip — same material as the content
 * panels and the paper nav bar, closing the page the way the bar opens it.
 *
 * Extra bottom padding on phones keeps the links clear of the floating
 * theme/sky buttons pinned to the bottom-left corner.
 */
export default function Footer() {
  return (
    <footer className="relative z-10 border-t border-border-hairline bg-surface">
      <div className="mx-auto w-full max-w-6xl px-6 pb-24 pt-10 text-center sm:pb-10">
        <nav className="flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-sm font-medium text-text-secondary">
          <Link href="/about" className="py-1 hover:text-foreground">
            About
          </Link>
          <Link href="/privacy" className="py-1 hover:text-foreground">
            Privacy
          </Link>
          <Link href="/terms" className="py-1 hover:text-foreground">
            Terms
          </Link>
          <a
            href="https://ubcgrades.com"
            target="_blank"
            rel="noopener noreferrer"
            className="whitespace-nowrap py-1 hover:text-foreground"
          >
            Grade data: UBC PAIR
          </a>
        </nav>
        <p className="mt-4 text-[13px] text-text-tertiary">
          © 2026 UBC Flow ·{' '}
          <span className="whitespace-nowrap">Built by students, not affiliated with UBC</span>
        </p>
      </div>
    </footer>
  );
}
