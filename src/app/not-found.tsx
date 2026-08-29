import Link from 'next/link';
import SearchBar from '@/components/SearchBar';

/**
 * Replaces Next's default, which renders "This page could not be found" on a
 * bare white page — outside the layout, so no nav, no branding and no way
 * back. Course and professor URLs are guessable (/course/cpsc-110), so a
 * mistyped one is a page real people reach, and the thing they wanted is a
 * search away rather than a dead end.
 */
export default function NotFound() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center px-6 py-24 text-center">
      <p className="sky-hero text-sm font-medium uppercase tracking-widest opacity-70">404</p>
      <h1 className="sky-hero mt-3 text-3xl font-semibold tracking-tight">
        We couldn&rsquo;t find that page
      </h1>
      <p className="sky-hero mx-auto mt-3 max-w-md text-sm opacity-80">
        The link may be out of date, or the course code may not exist. Try searching for it.
      </p>

      <div className="mt-8">
        <SearchBar defaultValue="" />
      </div>

      <div className="mt-8 flex flex-wrap justify-center gap-2">
        <Link
          href="/"
          className="rounded-pill border border-border px-4 py-2.5 text-sm font-medium text-foreground hover:bg-surface-muted"
        >
          Home
        </Link>
        <Link
          href="/explore"
          className="rounded-pill border border-border px-4 py-2.5 text-sm font-medium text-foreground hover:bg-surface-muted"
        >
          Browse courses
        </Link>
      </div>
    </main>
  );
}
