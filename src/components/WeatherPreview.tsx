'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { saveThemeMode } from '@/app/actions/theme';
import { DEFAULT_MODE } from '@/lib/theme';

// ponytail: temporary dev control - lets you preview every sky state without
// waiting for real weather. Delete this component (and its line in layout.tsx)
// once the weather mode is signed off.

const CONDITIONS = ['clear', 'cloudy', 'overcast', 'fog', 'rain', 'snow', 'storm'] as const;
type Condition = (typeof CONDITIONS)[number];

/**
 * The panel reads its selection off <html> instead of keeping its own copy.
 *
 * It used to hold `night`/`condition` in state seeded to day + rain, so the
 * highlighted buttons described whatever was last previewed rather than what
 * the sky was actually doing - pick "Campus weather" and the panel would
 * still claim Day + Rain over a clear night. Everything that changes the sky
 * (this panel, the theme menu, the campus-weather refresh) writes these two
 * attributes, so deriving from them is the one source that cannot go stale.
 */
function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-weather', 'data-theme'],
  });
  return () => observer.disconnect();
}

// A joined string, because useSyncExternalStore compares snapshots by
// identity - returning a fresh object each read would loop forever.
const readSky = () => {
  const r = document.documentElement;
  return `${r.getAttribute('data-weather') ?? ''}|${r.getAttribute('data-theme') ?? ''}`;
};

export default function WeatherPreview() {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const sky = useSyncExternalStore(subscribe, readSky, () => '|');
  const [weatherAttr, themeAttr] = sky.split('|');
  // Null in Day/Night/Light/Dark, where no condition is being drawn at all -
  // highlighting one anyway would be the same lie in a smaller form.
  const condition = (CONDITIONS as readonly string[]).includes(weatherAttr)
    ? (weatherAttr as Condition)
    : null;
  const night = themeAttr === 'dark';

  // Same dismissal the theme menu has, so whichever of the two you reach for
  // closes the other instead of the pair stacking up in the corner.
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

  // Writes only to the attributes; the observer above turns that back into the
  // highlighted buttons, so there is no second copy of the state to drift.
  function show(cond: Condition, isNight: boolean) {
    const r = document.documentElement;
    // A click that changes the sky's day/night is a real mode switch, not just
    // a preview: in campus weather the refresh poll would otherwise repaint
    // over it, and in day/night the theme menu would otherwise contradict the
    // sky on screen. Plain light/dark draw no sky, so those stay untouched.
    const stored = localStorage.getItem('theme') ?? DEFAULT_MODE;
    const mode = isNight ? 'night' : 'day';
    if (['weather', 'day', 'night'].includes(stored) && stored !== mode) {
      r.setAttribute('data-mode', mode);
      localStorage.setItem('theme', mode);
      void saveThemeMode(mode);
    }
    r.setAttribute('data-theme', isNight ? 'dark' : 'light');
    r.setAttribute('data-weather', cond);
  }

  return (
    // max-sm:hidden - on phones this dev control parked on top of the login
    // panel's Google button; preview skies from a desktop instead.
    <div ref={containerRef} className="fixed bottom-6 left-20 z-50 max-sm:hidden">
      {open && (
        <div className="absolute bottom-14 left-0 w-56 rounded-card border border-border bg-surface p-3 shadow-lg">
          <p className="text-xs font-medium text-text-secondary">Preview sky</p>

          <div className="mt-2 flex overflow-hidden rounded-pill border border-border text-xs font-medium">
            <button
              type="button"
              onClick={() => show(condition ?? 'clear', false)}
              className={`flex-1 px-3 py-1.5 ${!night ? 'bg-brand text-brand-foreground' : 'text-foreground hover:bg-surface-muted'}`}
            >
              Day
            </button>
            <button
              type="button"
              onClick={() => show(condition ?? 'clear', true)}
              className={`flex-1 px-3 py-1.5 ${night ? 'bg-brand text-brand-foreground' : 'text-foreground hover:bg-surface-muted'}`}
            >
              Night
            </button>
          </div>

          <div className="mt-2 grid grid-cols-2 gap-1.5">
            {CONDITIONS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => show(c, night)}
                className={`rounded-pill border px-3 py-1.5 text-xs font-medium capitalize ${
                  condition === c
                    ? 'border-brand bg-brand text-brand-foreground'
                    : 'border-border text-foreground hover:bg-surface-muted'
                }`}
              >
                {c}
              </button>
            ))}
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-label="Preview weather states"
        aria-expanded={open}
        className="flex h-11 items-center gap-1.5 rounded-full border border-border bg-surface px-4 text-xs font-medium text-foreground shadow-sm transition duration-150 ease-out hover:scale-[1.05] hover:bg-surface-muted active:scale-100"
      >
        Sky
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.75}
          className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`}
        >
          <path d="m6 15 6-6 6 6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    </div>
  );
}
