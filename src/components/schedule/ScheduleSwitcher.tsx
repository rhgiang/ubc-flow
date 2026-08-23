'use client';

import { useEffect, useRef, useState } from 'react';

export type ScheduleOption = { id: string; name: string; termName: string };

/**
 * Switches between the student's saved schedules from inside the builder.
 *
 * Selection is reported rather than navigated: the builder holds the unsaved
 * work, so it is the only thing that can decide whether leaving is safe.
 */
export default function ScheduleSwitcher({
  schedules,
  currentId,
  onSelect,
}: {
  schedules: ScheduleOption[];
  currentId: string | null;
  onSelect: (scheduleId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

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

  // A draft with no saved schedules to switch to has nothing to offer.
  if (schedules.length === 0) return null;

  return (
    <div ref={containerRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Switch to another saved schedule"
        title="Switch schedule"
        className="rounded-input border border-border p-2 text-text-secondary transition-colors hover:bg-surface-muted hover:text-foreground"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="h-4 w-4">
          <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <ul
          role="listbox"
          className="absolute left-0 top-full z-30 mt-1 max-h-72 w-72 overflow-y-auto rounded-card border border-border bg-surface py-1 shadow-lg"
        >
          {schedules.map((s) => {
            const current = s.id === currentId;
            return (
              <li key={s.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={current}
                  disabled={current}
                  onClick={() => {
                    setOpen(false);
                    onSelect(s.id);
                  }}
                  className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm transition-colors ${
                    current
                      ? 'cursor-default text-text-tertiary'
                      : 'text-foreground hover:bg-surface-muted'
                  }`}
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{s.name}</span>
                    <span className="block truncate text-xs text-text-tertiary">{s.termName}</span>
                  </span>
                  {current && <span className="shrink-0 text-xs">Current</span>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
