'use client';

import { useEffect, useRef } from 'react';
import type { MissingCompanions } from '@/schedule/companions';

/**
 * A course that fields labs or tutorials usually requires one of each — but
 * only Workday knows for certain, so like the conflict gate this asks rather
 * than blocks. Save is the moment the question matters: planning with just
 * the lecture is a normal way to sketch.
 */
export default function MissingSectionsDialog({
  missing,
  onConfirm,
  onCancel,
}: {
  missing: MissingCompanions[];
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (missing.length === 0) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      // Capture-phase + stopImmediatePropagation, for the same reason as
      // ConflictSaveDialog: this can sit on top of UnsavedWorkDialog, both
      // listen on `document`, and one Escape must not fire both.
      e.stopImmediatePropagation();
      onCancel();
    }
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [missing.length, onCancel]);

  useEffect(() => {
    dialogRef.current?.focus();
  }, [missing.length]);

  if (missing.length === 0) return null;

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50 p-4"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Confirm saving with missing course sections"
        className="w-full max-w-md rounded-card border border-border bg-background p-5"
      >
        <p className="text-sm font-medium text-foreground">
          Some courses look incomplete
        </p>
        <ul className="mt-2 space-y-1 text-sm text-text-secondary">
          {missing.map((m) => (
            <li key={m.code}>
              <span className="font-medium text-foreground">{m.code}</span> also offers{' '}
              {m.missing.join(' and ')} sections you haven&apos;t added.
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-text-tertiary">
          UBC usually requires one of each. Registration itself happens in Workday, so if a
          section really is optional, saving without it is fine.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-pill bg-brand px-4 py-1.5 text-sm font-medium text-brand-foreground hover:bg-brand-hover"
          >
            Go back and add them
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-pill border border-border px-4 py-1.5 text-sm font-medium text-foreground hover:bg-surface-muted"
          >
            Save anyway
          </button>
        </div>
      </div>
    </div>
  );
}
