'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

const DEBOUNCE_MS = 250;

export default function ExploreSearchInput() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const tab = searchParams.get('tab') === 'professors' ? 'professors' : 'courses';
  const urlQuery = searchParams.get('q') ?? '';

  const [value, setValue] = useState(urlQuery);
  // Tracks the URL value the input was last synced to - lets the render
  // below detect an EXTERNAL change (Clear filter, back/forward) and reset
  // local state, without the effect-cascade of syncing inside a useEffect.
  const [syncedQuery, setSyncedQuery] = useState(urlQuery);
  if (urlQuery !== syncedQuery) {
    setSyncedQuery(urlQuery);
    setValue(urlQuery);
  }

  useEffect(() => {
    if (value === urlQuery) return;
    const timer = setTimeout(() => {
      const params = new URLSearchParams(searchParams);
      if (value.trim()) params.set('q', value);
      else params.delete('q');
      // A new query is a new result set - page 4 of the old one would go stale.
      params.delete('page');
      router.replace(`${pathname}?${params.toString()}`);
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [value, urlQuery, searchParams, router, pathname]);

  return (
    <input
      value={value}
      onChange={(e) => setValue(e.target.value)}
      placeholder={tab === 'courses' ? 'Search course' : 'Search professor'}
      className="w-full rounded-pill border border-border bg-surface px-4 py-2.5 text-sm text-foreground placeholder:text-text-tertiary focus:border-foreground focus:outline-none"
    />
  );
}
