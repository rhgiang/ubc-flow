import Link from 'next/link';

/**
 * Site footer. Lives in the sky rather than on a solid strip — .sky-footer
 * (globals.css) gives it the white-with-halo treatment the nav uses, and
 * swaps to ink-on-paper in the high-contrast modes where the sky is off.
 *
 * Extra bottom padding on phones keeps the links clear of the floating
 * theme/sky buttons pinned to the bottom-left corner.
 */
export default function Footer() {
  return (
    <footer className="sky-footer relative z-10">
      <div className="mx-auto w-full max-w-6xl px-6 pb-24 pt-12 text-center sm:pb-10">
        <nav className="flex flex-wrap items-center justify-center gap-x-7 gap-y-3 text-sm font-medium">
          <Link href="/about" className="py-1 hover:text-foreground hover:underline">
            About
          </Link>
          <Link href="/privacy" className="py-1 hover:text-foreground hover:underline">
            Privacy
          </Link>
          <Link href="/terms" className="py-1 hover:text-foreground hover:underline">
            Terms
          </Link>
          <a
            href="https://ubcgrades.com"
            target="_blank"
            rel="noopener noreferrer"
            className="whitespace-nowrap py-1 hover:text-foreground hover:underline"
          >
            Grade data: UBC PAIR
          </a>
        </nav>
        <p className="mt-4 text-[13px]">
          © 2026 UBC Flow ·{' '}
          <span className="whitespace-nowrap">Built by students, not affiliated with UBC</span>
        </p>
      </div>
    </footer>
  );
}
