'use client';

import { useEffect } from 'react';
import type { WeatherNow } from '@/lib/weather';

/**
 * Cycles light → dark → weather → contrast.
 *
 * The stored mode lives in localStorage as `theme`. `data-mode` on <html>
 * records the chosen mode (icons key off it); `data-theme` stays light/dark/
 * contrast and keeps driving every existing CSS token rule. Weather mode maps
 * to light or dark from campus daylight and adds `data-weather` so the sky
 * layers and shader can match conditions outside.
 *
 * All four icons render always; CSS attribute selectors decide which shows —
 * same no-hydration-mismatch trick as the old two-state toggle.
 */

const MODES = ['light', 'dark', 'weather', 'contrast'] as const;
type Mode = (typeof MODES)[number];

function apply(mode: Mode, weather: WeatherNow | null) {
  const root = document.documentElement;
  root.setAttribute('data-mode', mode);
  if (mode === 'weather') {
    // No data (fetch failed): daylight falls back to the local clock, and the
    // sky keeps its default clouds.
    const hour = new Date().getHours();
    const day = weather ? weather.isDay : hour >= 7 && hour < 19;
    root.setAttribute('data-theme', day ? 'light' : 'dark');
    root.setAttribute('data-weather', weather?.condition ?? 'cloudy');
  } else {
    root.setAttribute('data-theme', mode);
    root.removeAttribute('data-weather');
  }
}

export default function ThemeToggle({ weather }: { weather: WeatherNow | null }) {
  // The inline init script guessed daylight from the clock; re-apply with the
  // real observation once it's available.
  useEffect(() => {
    const stored = localStorage.getItem('theme');
    if (stored === 'weather') apply('weather', weather);
  }, [weather]);

  function cycle() {
    const current = (document.documentElement.getAttribute('data-mode') ?? 'light') as Mode;
    const next = MODES[(MODES.indexOf(current) + 1) % MODES.length];
    apply(next, weather);
    localStorage.setItem('theme', next);
  }

  return (
    <button
      type="button"
      onClick={cycle}
      aria-label="Switch theme"
      title="Theme: light → dark → campus weather → high contrast"
      className="fixed bottom-6 left-6 z-50 flex h-11 w-11 items-center justify-center rounded-full border border-border bg-surface text-foreground shadow-sm transition duration-150 ease-out hover:scale-[1.05] hover:bg-surface-muted active:scale-100"
    >
      {/* Sun — light mode is active (also the pre-hydration default) */}
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.75}
        className="hidden h-5 w-5 [html[data-mode=light]_&]:block [html:not([data-mode])_&]:block"
      >
        <circle cx="12" cy="12" r="4.5" />
        <path
          d="M12 2.5v2M12 19.5v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M2.5 12h2M19.5 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4"
          strokeLinecap="round"
        />
      </svg>
      {/* Moon — dark mode is active */}
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.75}
        className="hidden h-5 w-5 [html[data-mode=dark]_&]:block"
      >
        <path
          d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5Z"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {/* Cloud — weather mode is active */}
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.75}
        className="hidden h-5 w-5 [html[data-mode=weather]_&]:block"
      >
        <path
          d="M7 18a4 4 0 0 1-.6-7.96 5.5 5.5 0 0 1 10.8 1.06A3.5 3.5 0 0 1 16.5 18Z"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {/* Half-filled circle — high contrast is active */}
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.75}
        className="hidden h-5 w-5 [html[data-mode=contrast]_&]:block"
      >
        <circle cx="12" cy="12" r="9" />
        <path d="M12 3a9 9 0 0 1 0 18Z" fill="currentColor" stroke="none" />
      </svg>
    </button>
  );
}
