'use client';

import { usePathname } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import SkyClouds from '@/components/SkyClouds';
import Footer from '@/components/Footer';

/**
 * Sky background for every route except the schedule builder
 * (/schedule/new, /schedule/[id]) - a builder page needs the ordinary
 * light/dark surface to stay readable over a dense calendar grid, so it
 * opts out entirely.
 *
 * The nav is passed in rather than rendered by the layout so it can live
 * inside the sky container and pick up the transparent treatment there.
 */
export default function PageBackground({
  nav,
  children,
}: {
  nav: ReactNode;
  children: ReactNode;
}) {
  const pathname = usePathname();

  // Home gets the full sky; every content page dims it to a backdrop - the
  // shader and the veil both read this attribute.
  const dim = pathname !== '/';
  useEffect(() => {
    const root = document.documentElement;
    if (dim) root.setAttribute('data-sky-dim', '');
    else root.removeAttribute('data-sky-dim');
    return () => root.removeAttribute('data-sky-dim');
  }, [dim]);

  if (pathname.startsWith('/schedule/')) {
    return (
      <>
        {nav}
        {children}
      </>
    );
  }

  return (
    <div className="sky-root flex flex-1 flex-col">
      <div className="sky-layer sky-base" aria-hidden="true" />
      <div className="sky-layer sky-stars" aria-hidden="true" />
      <SkyClouds />
      <div className="sky-layer sky-veil" aria-hidden="true" />
      {nav}
      <div className="relative z-10 flex flex-1 flex-col">{children}</div>
      <Footer />
    </div>
  );
}
