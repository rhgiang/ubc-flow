'use client';

import { useEffect } from 'react';
import type { WeatherNow } from '@/lib/weather';

/**
 * Two stacked buttons, bottom-left.
 *
 * Top: light/dark toggle — the classic pair, always one press.
 * Bottom: the special modes — off → weather → contrast → off. Entering one
 * remembers the plain theme; leaving restores it.
 *
 * The stored mode lives in localStorage as `theme` (light | dark | weather |
 * contrast); `theme-plain` remembers which plain theme to come back to.
 * `data-mode` on <html> records the chosen mode (icons and button highlights
 * key off it); `data-theme` stays light/dark/contrast and keeps driving every
 * CSS token rule. Weather mode maps to light or dark from campus daylight and
 * adds `data-weather` so the sky layers and shader match conditions outside.
 *
 * All icons render always; CSS attribute selectors decide what shows — the
 * usual no-hydration-mismatch trick.
 */

type Mode = 'light' | 'dark' | 'weather' | 'contrast';

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
  localStorage.setItem('theme', mode);
  if (mode === 'light' || mode === 'dark') localStorage.setItem('theme-plain', mode);
}

export default function ThemeToggle({ weather }: { weather: WeatherNow | null }) {
  // The inline init script guessed daylight from the clock; re-apply with the
  // real observation once it's available.
  useEffect(() => {
    if (localStorage.getItem('theme') === 'weather') apply('weather', weather);
  }, [weather]);

  function plainTheme(): Mode {
    const stored = localStorage.getItem('theme-plain');
    return stored === 'dark' ? 'dark' : 'light';
  }

  function toggleLightDark() {
    // From a special mode this exits it, flipping from whatever is showing.
    const showingDark = document.documentElement.getAttribute('data-theme') === 'dark';
    apply(showingDark ? 'light' : 'dark', weather);
  }

  function cycleSpecial() {
    const mode = document.documentElement.getAttribute('data-mode');
    if (mode === 'weather') apply('contrast', weather);
    else if (mode === 'contrast') apply(plainTheme(), weather);
    else apply('weather', weather);
  }

  const btn =
    'flex h-11 w-11 items-center justify-center rounded-full border border-border bg-surface text-foreground shadow-sm transition duration-150 ease-out hover:scale-[1.05] hover:bg-surface-muted active:scale-100';

  return (
    <div className="fixed bottom-6 left-6 z-50 flex flex-col gap-2">
      <button type="button" onClick={toggleLightDark} aria-label="Toggle dark mode" className={btn}>
        {/* Moon — shown while light, click to go dark (pre-hydration default) */}
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.75}
          className="h-5 w-5 [html[data-theme=dark]_&]:hidden"
        >
          <path
            d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5Z"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        {/* Sun — shown while dark, click to go light */}
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.75}
          className="hidden h-5 w-5 [html[data-theme=dark]_&]:block"
        >
          <circle cx="12" cy="12" r="4.5" />
          <path
            d="M12 2.5v2M12 19.5v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M2.5 12h2M19.5 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4"
            strokeLinecap="round"
          />
        </svg>
      </button>

      <button
        type="button"
        onClick={cycleSpecial}
        aria-label="Campus weather and high contrast modes"
        title="Off → campus weather → high contrast"
        className={`${btn} [html[data-mode=contrast]_&]:border-brand [html[data-mode=contrast]_&]:bg-brand [html[data-mode=contrast]_&]:text-brand-foreground [html[data-mode=weather]_&]:border-brand [html[data-mode=weather]_&]:bg-brand [html[data-mode=weather]_&]:text-brand-foreground`}
      >
        {/* Cloud — the resting face, and the active face while in weather mode */}
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.75}
          className="h-5 w-5 [html[data-mode=contrast]_&]:hidden"
        >
          <path
            d="M7 18a4 4 0 0 1-.6-7.96 5.5 5.5 0 0 1 10.8 1.06A3.5 3.5 0 0 1 16.5 18Z"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        {/* Half-filled circle — shown while high contrast is active */}
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
    </div>
  );
}
