'use client';

import { useEffect, useRef, useState } from 'react';

// ponytail: temporary dev control — lets you preview every sky state without
// waiting for real weather. Delete this component (and its line in layout.tsx)
// once the weather mode is signed off.

const CONDITIONS = ['clear', 'cloudy', 'overcast', 'fog', 'rain', 'snow', 'storm'] as const;
type Condition = (typeof CONDITIONS)[number];

export default function WeatherPreview() {
  const [open, setOpen] = useState(false);
  const [night, setNight] = useState(false);
  const [condition, setCondition] = useState<Condition>('rain');
  const containerRef = useRef<HTMLDivElement>(null);

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

  function show(cond: Condition, isNight: boolean) {
    setCondition(cond);
    setNight(isNight);
    const r = document.documentElement;
    r.setAttribute('data-mode', 'weather');
    r.setAttribute('data-theme', isNight ? 'dark' : 'light');
    r.setAttribute('data-weather', cond);
  }

  return (
    <div ref={containerRef} className="fixed bottom-6 left-20 z-50">
      {open && (
        <div className="absolute bottom-14 left-0 w-56 rounded-card border border-border bg-surface p-3 shadow-lg">
          <p className="text-xs font-medium text-text-secondary">Preview sky</p>

          <div className="mt-2 flex overflow-hidden rounded-pill border border-border text-xs font-medium">
            <button
              type="button"
              onClick={() => show(condition, false)}
              className={`flex-1 px-3 py-1.5 ${!night ? 'bg-brand text-brand-foreground' : 'text-foreground hover:bg-surface-muted'}`}
            >
              Day
            </button>
            <button
              type="button"
              onClick={() => show(condition, true)}
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
