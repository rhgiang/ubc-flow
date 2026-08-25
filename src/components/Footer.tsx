import Link from 'next/link';

/**
 * Site footer. Rendered inside the sky container (PageBackground), so it
 * needs its own opaque substrate: a full-width bg-background strip with a
 * hairline top border reads in every theme — solid over the sky, and it
 * inherits the high-contrast tokens for free when the sky is switched off.
 */
export default function Footer() {
  return (
    <footer className="relative z-10 border-t border-border-hairline bg-background">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-6 py-6 text-xs text-text-secondary">
        <p>
          © 2026 UBC Flow · <span className="whitespace-nowrap">Built by students, not affiliated with UBC</span>
        </p>
        <nav className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <Link href="/about" className="hover:text-foreground">
            About
          </Link>
          <Link href="/privacy" className="hover:text-foreground">
            Privacy
          </Link>
          <Link href="/terms" className="hover:text-foreground">
            Terms
          </Link>
          <a
            href="https://ubcgrades.com"
            target="_blank"
            rel="noopener noreferrer"
            className="whitespace-nowrap hover:text-foreground"
          >
            Grade data: UBC PAIR
          </a>
        </nav>
      </div>
    </footer>
  );
}
