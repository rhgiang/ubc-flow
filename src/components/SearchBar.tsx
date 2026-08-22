'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';

export default function SearchBar({ defaultValue }: { defaultValue: string }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  return (
    <div
      ref={containerRef}
      className="relative mx-auto mt-8 max-w-xl"
      onFocus={() => setOpen(true)}
      onBlur={(e) => {
        // Only close if focus actually left the container (not just moved
        // from the input to the dropdown link inside it).
        if (!containerRef.current?.contains(e.relatedTarget as Node)) setOpen(false);
      }}
    >
      <form className="flex items-center gap-2 rounded-pill border border-border bg-surface px-5 py-3 shadow-sm">
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
          defaultValue={defaultValue}
          placeholder="Search course, subject, or professor — ex: Math 101"
          className="w-full bg-transparent text-sm text-foreground placeholder:text-text-tertiary focus:outline-none"
        />
      </form>

      {open && (
        <div className="absolute inset-x-0 top-full z-10 mt-2 overflow-hidden rounded-card border border-border bg-surface shadow-lg">
          <Link
            href="/explore"
            className="flex items-center gap-2 px-5 py-3 text-left text-sm text-foreground hover:bg-surface-muted"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.75}
              className="h-4 w-4 shrink-0 text-text-tertiary"
            >
              <rect x="3" y="3" width="7" height="7" rx="1.5" />
              <rect x="14" y="3" width="7" height="7" rx="1.5" />
              <rect x="3" y="14" width="7" height="7" rx="1.5" />
              <rect x="14" y="14" width="7" height="7" rx="1.5" />
            </svg>
            Explore all courses and professors
          </Link>
        </div>
      )}
    </div>
  );
}
