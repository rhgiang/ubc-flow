'use client';

import { useEffect, useRef, useState } from 'react';
import type { WeatherNow } from '@/lib/weather';

/**
 * One button, bottom-left, showing the current mode's icon. Clicking opens a
 * small menu naming all four modes — no blind cycling, one press then one
 * labeled choice.
 *
 * The stored mode lives in localStorage as `theme` (light | dark | weather |
 * contrast). `data-mode` on <html> records the chosen mode (the button icon
 * and menu checkmarks key off it via CSS attribute selectors, so nothing here
 * needs hydration-sensitive state); `data-theme` stays light/dark/contrast
 * and keeps driving every CSS token rule. Weather mode maps to light or dark
 * from campus daylight and adds `data-weather` so the sky layers and shader
 * match conditions outside.
 */

type Mode = 'light' | 'dark' | 'weather' | 'contrast' | 'contrast-dark';

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
}

const SUN = (
  <>
    <circle cx="12" cy="12" r="4.5" />
    <path
      d="M12 2.5v2M12 19.5v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M2.5 12h2M19.5 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4"
      strokeLinecap="round"
    />
  </>
);
const MOON = (
  <path
    d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5Z"
    strokeLinecap="round"
    strokeLinejoin="round"
  />
);
const CLOUD = (
  <path
    d="M7 18a4 4 0 0 1-.6-7.96 5.5 5.5 0 0 1 10.8 1.06A3.5 3.5 0 0 1 16.5 18Z"
    strokeLinecap="round"
    strokeLinejoin="round"
  />
);
const CONTRAST = (
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 3a9 9 0 0 1 0 18Z" fill="currentColor" stroke="none" />
  </>
);
const CONTRAST_DARK = (
  <>
    <circle cx="12" cy="12" r="9" fill="currentColor" />
    <path d="M12 3a9 9 0 0 1 0 18Z" fill="var(--surface)" stroke="none" />
  </>
);

const OPTIONS: { mode: Mode; label: string; icon: React.ReactNode }[] = [
  { mode: 'light', label: 'Light', icon: SUN },
  { mode: 'dark', label: 'Dark', icon: MOON },
  { mode: 'weather', label: 'Campus weather', icon: CLOUD },
  { mode: 'contrast', label: 'High contrast', icon: CONTRAST },
  { mode: 'contrast-dark', label: 'High contrast dark', icon: CONTRAST_DARK },
];

// Shows this option's icon on the trigger button only while its mode is
// active. Literal strings — Tailwind can't see interpolated class names.
const ICON_WHEN_ACTIVE: Record<Mode, string> = {
  light: 'hidden [html[data-mode=light]_&]:block [html:not([data-mode])_&]:block',
  dark: 'hidden [html[data-mode=dark]_&]:block',
  weather: 'hidden [html[data-mode=weather]_&]:block',
  contrast: 'hidden [html[data-mode=contrast]_&]:block',
  'contrast-dark': 'hidden [html[data-mode=contrast-dark]_&]:block',
};

// Highlights this menu row while its mode is active.
const ROW_WHEN_ACTIVE: Record<Mode, string> = {
  light: '[html[data-mode=light]_&]:bg-brand [html[data-mode=light]_&]:text-brand-foreground [html:not([data-mode])_&]:bg-brand [html:not([data-mode])_&]:text-brand-foreground',
  dark: '[html[data-mode=dark]_&]:bg-brand [html[data-mode=dark]_&]:text-brand-foreground',
  weather: '[html[data-mode=weather]_&]:bg-brand [html[data-mode=weather]_&]:text-brand-foreground',
  contrast: '[html[data-mode=contrast]_&]:bg-brand [html[data-mode=contrast]_&]:text-brand-foreground',
  'contrast-dark':
    '[html[data-mode=contrast-dark]_&]:bg-brand [html[data-mode=contrast-dark]_&]:text-brand-foreground',
};

export default function ThemeToggle({ weather }: { weather: WeatherNow | null }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // The inline init script guessed daylight from the clock; re-apply with the
  // real observation once it's available.
  useEffect(() => {
    if (localStorage.getItem('theme') === 'weather') apply('weather', weather);
  }, [weather]);

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClickOutside);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="fixed bottom-6 left-6 z-50">
      {open && (
        <div className="absolute bottom-14 left-0 w-48 overflow-hidden rounded-card border border-border bg-surface py-1 shadow-lg">
          {OPTIONS.map((o) => (
            <button
              key={o.mode}
              type="button"
              onClick={() => {
                apply(o.mode, weather);
                setOpen(false);
              }}
              className={`flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm font-medium text-foreground hover:bg-surface-muted ${ROW_WHEN_ACTIVE[o.mode]}`}
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.75}
                className="h-4 w-4 shrink-0"
              >
                {o.icon}
              </svg>
              {o.label}
            </button>
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-label="Choose theme"
        aria-expanded={open}
        className="flex h-11 w-11 items-center justify-center rounded-full border border-border bg-surface text-foreground shadow-sm transition duration-150 ease-out hover:scale-[1.05] hover:bg-surface-muted active:scale-100"
      >
        {OPTIONS.map((o) => (
          <svg
            key={o.mode}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.75}
            className={`h-5 w-5 ${ICON_WHEN_ACTIVE[o.mode]}`}
          >
            {o.icon}
          </svg>
        ))}
      </button>
    </div>
  );
}
