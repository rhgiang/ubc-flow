'use client';

import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

/** Within this distance of the top the bar is always shown. */
const TOP_ZONE = 90;
/** Ignore scroll jitter below this many pixels, so the bar doesn't flicker. */
const DELTA = 6;

/**
 * Hides the nav on the way down and brings it back on the way up.
 *
 * Only the wrapper lives here; the styling for the hidden state is scoped to
 * sky pages in globals.css, so the schedule builder's bar is unaffected (its
 * document never scrolls anyway, so this stays idle there).
 */
export default function NavShell({ children }: { children: ReactNode }) {
  const [hidden, setHidden] = useState(false);
  // Past the top zone the frosted bar turns solid navy (see globals.css) —
  // fully translucent glass only makes sense while the sky is the show.
  const [scrolled, setScrolled] = useState(false);
  const lastY = useRef(0);
  const ticking = useRef(false);

  useEffect(() => {
    lastY.current = window.scrollY;
    setScrolled(window.scrollY > TOP_ZONE);

    const onScroll = () => {
      // Coalesce bursts of scroll events into one update per frame.
      if (ticking.current) return;
      ticking.current = true;
      requestAnimationFrame(() => {
        const y = window.scrollY;
        const diff = y - lastY.current;
        setScrolled(y > TOP_ZONE);
        if (y <= TOP_ZONE) {
          setHidden(false);
          lastY.current = y;
        } else if (Math.abs(diff) > DELTA) {
          setHidden(diff > 0);
          lastY.current = y;
        }
        ticking.current = false;
      });
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header
      className="border-b border-border-hairline bg-background"
      data-nav-hidden={hidden || undefined}
      data-nav-scrolled={scrolled || undefined}
    >
      {children}
    </header>
  );
}
