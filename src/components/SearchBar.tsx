'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { liveSearch } from '@/app/actions/search';
import type { LiveSearchResult } from '@/lib/search';

const EMPTY: LiveSearchResult = {
  courses: [],
  professors: [],
  exploreLabel: 'courses and professors',
  exploreHref: '/explore',
};
const DEBOUNCE_MS = 200;

function courseHref(code: string): string {
  return `/course/${code.toLowerCase().replace(/\s+/g, '-')}`;
}

export default function SearchBar({ defaultValue }: { defaultValue: string }) {
  const [query, setQuery] = useState(defaultValue);
  const [result, setResult] = useState<LiveSearchResult>(EMPTY);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    // An empty query needs no fetch — rendering falls back to EMPTY directly
    // below rather than resetting state here (setState synchronously inside
    // an effect body triggers an avoidable extra render).
    if (!query.trim()) return;

    let cancelled = false;
    const timer = setTimeout(async () => {
      const r = await liveSearch(query);
      if (!cancelled) setResult(r);
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  const shown = query.trim() ? result : EMPTY;

  return (
    <div
      ref={containerRef}
      className="relative mx-auto mt-9 max-w-xl"
      onFocus={() => setOpen(true)}
      onBlur={(e) => {
        // Only close if focus actually left the container (not just moved
        // from the input to a row inside the dropdown).
        if (!containerRef.current?.contains(e.relatedTarget as Node)) setOpen(false);
      }}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setOpen(false);
          router.push(`/explore?q=${encodeURIComponent(query)}`);
        }}
        className="flex items-center gap-2 rounded-pill border border-border bg-surface px-5 py-3.5 shadow-sm transition-transform duration-150 ease-out hover:scale-[1.02] active:scale-100"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.75}
          className="h-5 w-5 shrink-0 text-text-tertiary"
        >
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" strokeLinecap="round" />
        </svg>
        <input
          name="q"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search course, subject, or professor — ex: Math 101"
          className="w-full bg-transparent text-sm text-foreground placeholder:text-text-tertiary focus:outline-none"
        />
      </form>

      {open && (
        <div className="absolute inset-x-0 top-full z-10 mt-2 overflow-hidden rounded-card border border-border bg-surface text-left shadow-lg">
          {shown.courses.map((c) => (
            <Link
              key={c.code}
              href={courseHref(c.code)}
              className="flex items-baseline gap-2 px-5 py-2.5 text-sm hover:bg-surface-muted"
            >
              <span className="font-medium text-foreground">{c.code}</span>
              <span className="truncate text-text-secondary">{c.title}</span>
            </Link>
          ))}
          {shown.professors.map((p) => (
            <Link
              key={p.slug}
              href={`/professor/${p.slug}`}
              className="flex items-baseline gap-2 px-5 py-2.5 text-sm hover:bg-surface-muted"
            >
              <span className="font-medium text-foreground">{p.name}</span>
              <span className="text-text-tertiary">Professor</span>
            </Link>
          ))}
          <Link
            href={shown.exploreHref}
            className="flex items-center gap-2 border-t border-border px-5 py-3 text-sm font-medium text-brand-accent hover:bg-surface-muted"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.75}
              className="h-4 w-4 shrink-0"
            >
              <rect x="3" y="3" width="7" height="7" rx="1.5" />
              <rect x="14" y="3" width="7" height="7" rx="1.5" />
              <rect x="3" y="14" width="7" height="7" rx="1.5" />
              <rect x="14" y="14" width="7" height="7" rx="1.5" />
            </svg>
            Explore all {shown.exploreLabel}
          </Link>
        </div>
      )}
    </div>
  );
}
