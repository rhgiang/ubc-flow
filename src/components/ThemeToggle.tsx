'use client';

import { useRef, useState, useEffect, useSyncExternalStore } from 'react';
import type { WeatherNow } from '@/lib/weather';
import { saveThemeMode } from '@/app/actions/theme';
import { type Mode, DEFAULT_MODE } from '@/lib/theme';

/**
 * One button showing the current mode's icon. Clicking opens a small menu
 * naming all five modes — no blind cycling, one press then one labeled choice.
 * The button can also be dragged to any corner, so it can be moved off
 * whatever it happens to be covering (the builder's course cards, most often).
 *
 * The stored mode lives in localStorage as `theme` (day | night | weather |
 * light | dark). `data-mode` on <html> records the chosen mode (the button icon
 * and menu checkmarks key off it via CSS attribute selectors, so nothing here
 * needs hydration-sensitive state); `data-theme` stays light or dark and keeps
 * driving every CSS token rule. Weather mode picks between them from campus
 * daylight and adds `data-weather` so the sky layers and shader match
 * conditions outside.
 */

/**
 * Day / Night / Campus weather are the sky; Light / Dark are the plain UI the
 * site had before it, charcoal dark included. Both families run on the same
 * two palettes — `data-plain` is the only thing that separates them, and it is
 * what globals.css and SkyClouds key the sky off.
 */
const PLAIN: Mode[] = ['light', 'dark'];

/**
 * The hour it is at UBC, not wherever the viewer is sitting. Campus weather
 * means campus: a student reading from Calgary was being put an hour into the
 * evening while it was still afternoon on campus.
 */
function campusHour(): number {
  return Number(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Vancouver',
      hour: 'numeric',
      hour12: false,
    }).format(new Date()),
  );
}

function apply(mode: Mode, weather: WeatherNow | null) {
  const root = document.documentElement;
  root.setAttribute('data-mode', mode);
  if (mode === 'weather') {
    // No data (fetch failed): fall back to campus daylight hours, and the sky
    // keeps its default clouds. 7-20 rather than 7-19 — Vancouver's sunset
    // runs past 21:00 midsummer and before 16:30 midwinter, so any fixed
    // window is a guess; this one errs toward daylight, which is both the
    // signature look and the answer more of the day agrees with.
    const day = weather ? weather.isDay : campusHour() >= 7 && campusHour() < 20;
    root.setAttribute('data-theme', day ? 'light' : 'dark');
    root.setAttribute('data-weather', weather?.condition ?? 'cloudy');
  } else {
    root.setAttribute('data-theme', mode === 'day' || mode === 'light' ? 'light' : 'dark');
    root.removeAttribute('data-weather');
  }
  if (PLAIN.includes(mode)) root.setAttribute('data-plain', '');
  else root.removeAttribute('data-plain');
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
const PLAIN_LIGHT = (
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 3a9 9 0 0 1 0 18Z" fill="currentColor" stroke="none" />
  </>
);
const PLAIN_DARK = (
  <>
    <circle cx="12" cy="12" r="9" fill="currentColor" />
    <path d="M12 3a9 9 0 0 1 0 18Z" fill="var(--surface)" stroke="none" />
  </>
);

const OPTIONS: { mode: Mode; label: string; icon: React.ReactNode }[] = [
  { mode: 'day', label: 'Day', icon: SUN },
  { mode: 'night', label: 'Night', icon: MOON },
  { mode: 'weather', label: 'Campus weather', icon: CLOUD },
  { mode: 'light', label: 'Light', icon: PLAIN_LIGHT },
  { mode: 'dark', label: 'Dark', icon: PLAIN_DARK },
];

// Shows this option's icon on the trigger button only while its mode is
// active. Literal strings — Tailwind can't see interpolated class names.
const ICON_WHEN_ACTIVE: Record<Mode, string> = {
  day: 'hidden [html[data-mode=day]_&]:block [html:not([data-mode])_&]:block',
  night: 'hidden [html[data-mode=night]_&]:block',
  weather: 'hidden [html[data-mode=weather]_&]:block',
  light: 'hidden [html[data-mode=light]_&]:block',
  dark: 'hidden [html[data-mode=dark]_&]:block',
};

// Highlights this menu row while its mode is active.
const ROW_WHEN_ACTIVE: Record<Mode, string> = {
  day: '[html[data-mode=day]_&]:bg-brand [html[data-mode=day]_&]:text-brand-foreground [html:not([data-mode])_&]:bg-brand [html:not([data-mode])_&]:text-brand-foreground',
  night: '[html[data-mode=night]_&]:bg-brand [html[data-mode=night]_&]:text-brand-foreground',
  weather: '[html[data-mode=weather]_&]:bg-brand [html[data-mode=weather]_&]:text-brand-foreground',
  light: '[html[data-mode=light]_&]:bg-brand [html[data-mode=light]_&]:text-brand-foreground',
  dark: '[html[data-mode=dark]_&]:bg-brand [html[data-mode=dark]_&]:text-brand-foreground',
};

const CORNER_KEY = 'theme-toggle-corner';

// The four resting spots, 24px in from each edge.
const INSET = 24;
const CORNERS = {
  tl: { top: INSET, left: INSET },
  tr: { top: INSET, right: INSET },
  bl: { bottom: INSET, left: INSET },
  br: { bottom: INSET, right: INSET },
} as const;
type Corner = keyof typeof CORNERS;

/** The menu hangs off whichever corner the button is parked in. */
function menuPlacement(corner: Corner): string {
  return `${corner.startsWith('t') ? 'top-14' : 'bottom-14'} ${
    corner.endsWith('l') ? 'left-0' : 'right-0'
  }`;
}

export default function ThemeToggle({ weather }: { weather: WeatherNow | null }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Read the parked corner through useSyncExternalStore rather than an effect:
  // the server (and the hydration pass) get 'bl', the client swaps in the saved
  // corner right after. Nothing ever writes to the store, so subscribe is a
  // no-op.
  const saved = useSyncExternalStore(
    () => () => {},
    () => localStorage.getItem(CORNER_KEY) ?? 'bl',
    () => 'bl',
  );
  const [moved, setMoved] = useState<Corner | null>(null);
  const corner = moved ?? (saved in CORNERS ? (saved as Corner) : 'bl');

  // The button stays anchored to its corner; dragging only translates it from
  // there. That way the snap-back is a plain transform transition — nothing
  // animates to `auto`, which is what a left/top swap would have asked for.
  const [off, setOff] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [snapping, setSnapping] = useState(false);
  const dragged = useRef(false);

  // The inline init script guessed daylight from the clock; re-apply with the
  // real observation once it's available. `?? DEFAULT_MODE` matters here: a
  // first-time visitor has nothing stored yet and still starts in weather
  // mode, so the guessed sky has to be corrected for them too.
  useEffect(() => {
    if ((localStorage.getItem('theme') ?? DEFAULT_MODE) === 'weather') {
      apply('weather', weather);
    }
  }, [weather]);

  // Campus conditions on a page that stays open. Without this, weather mode
  // is only ever as current as the last full page load — a tab left open
  // across sunset keeps drawing a daylight sky. Upstream is cached for 30
  // minutes, so a 15-minute poll costs a round trip and nothing more.
  useEffect(() => {
    const refresh = async () => {
      if (document.hidden) return;
      if ((localStorage.getItem('theme') ?? DEFAULT_MODE) !== 'weather') return;
      try {
        const res = await fetch('/api/weather');
        if (res.ok) apply('weather', (await res.json()) as WeatherNow | null);
      } catch {
        // Keep whatever sky is already up.
      }
    };
    const id = setInterval(refresh, 15 * 60 * 1000);
    // A backgrounded tab has its timers throttled, so the interval alone can
    // leave a sky hours out of date the moment you look at it again.
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('focus', refresh);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('focus', refresh);
    };
  }, []);

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

  function onPointerDown(e: React.PointerEvent<HTMLButtonElement>) {
    const el = e.currentTarget;
    const box = containerRef.current;
    if (!box) return;
    const rect = el.getBoundingClientRect();
    const start = { x: e.clientX, y: e.clientY };
    let d = { x: 0, y: 0 };
    dragged.current = false;
    setSnapping(false);
    el.setPointerCapture(e.pointerId);

    const move = (ev: PointerEvent) => {
      d = { x: ev.clientX - start.x, y: ev.clientY - start.y };
      // 4px of slop so a slightly shaky click still opens the menu.
      if (!dragged.current && Math.hypot(d.x, d.y) > 4) {
        dragged.current = true;
        setDragging(true);
        // A menu left open would fly around with the button.
        setOpen(false);
      }
      if (dragged.current) setOff(d);
    };
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      setDragging(false);
      if (!dragged.current) return;

      const end = { x: rect.left + d.x, y: rect.top + d.y };
      const next: Corner = `${end.y + rect.height / 2 < window.innerHeight / 2 ? 't' : 'b'}${
        end.x + rect.width / 2 < window.innerWidth / 2 ? 'l' : 'r'
      }`;
      const home = {
        x: next.endsWith('l') ? INSET : window.innerWidth - INSET - rect.width,
        y: next.startsWith('t') ? INSET : window.innerHeight - INSET - rect.height,
      };
      // Re-anchor to the new corner and re-express the current position as an
      // offset from it — same pixels on screen, no jump — then let the next
      // frame ease that offset to zero.
      setMoved(next);
      localStorage.setItem(CORNER_KEY, next);
      setOff({ x: end.x - home.x, y: end.y - home.y });
      // Two frames: one to let the re-anchored position actually paint, the
      // next to start the transition from it. One frame and the browser
      // collapses both into a single style pass — no animation at all.
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          setSnapping(true);
          setOff({ x: 0, y: 0 });
        }),
      );
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  }

  return (
    <div
      ref={containerRef}
      className={`fixed z-50 ${
        snapping
          ? // easeOutBack: overshoots the corner slightly, then settles.
            'transition-transform duration-500 ease-[cubic-bezier(0.34,1.5,0.5,1)] motion-reduce:transition-none'
          : ''
      }`}
      style={{
        ...CORNERS[corner],
        transform: `translate3d(${off.x}px, ${off.y}px, 0) scale(${dragging ? 1.08 : 1})`,
      }}
    >
      {open && (
        <div
          className={`absolute ${menuPlacement(corner)} w-48 overflow-hidden rounded-card border border-border bg-surface py-1 shadow-lg`}
        >
          {OPTIONS.map((o) => (
            <button
              key={o.mode}
              type="button"
              onClick={() => {
                apply(o.mode, weather);
                // Only a deliberate pick is persisted to the account —
                // apply() also runs on re-hydration, and saving there would
                // write the same value back on every page load.
                void saveThemeMode(o.mode);
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
        onPointerDown={onPointerDown}
        onClick={() => {
          if (dragged.current) {
            dragged.current = false;
            return;
          }
          setOpen(!open);
        }}
        aria-label="Choose theme"
        aria-expanded={open}
        title="Choose theme — drag to a corner to move"
        className="flex h-11 w-11 touch-none cursor-grab items-center justify-center rounded-full border border-border bg-surface text-foreground shadow-sm transition-colors duration-150 ease-out hover:bg-surface-muted active:cursor-grabbing"
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
