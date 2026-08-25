'use client';

import { useEffect, useRef } from 'react';
import type { ConflictPair } from '@/schedule/conflicts';

/**
 * Overlaps are legal to plan with and legal to save — UBC's meeting data can't
 * always prove a clash is real. This is the one place the student is asked,
 * because Save is where the overlap stops being a sketch.
 */
export default function ConflictSaveDialog({
  conflicts,
  onConfirm,
  onCancel,
}: {
  conflicts: ConflictPair[];
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (conflicts.length === 0) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      // This dialog can be mounted on top of UnsavedWorkDialog (the
      // "save and switch" flow), and both attach a bare document keydown
      // listener. Without stopping propagation, one Escape press would fire
      // both onCancel handlers — backing out of this confirmation AND
      // silently discarding the parked navigation underneath it. Only the
      // topmost dialog should consume the key.
      e.stopPropagation();
      onCancel();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [conflicts.length, onCancel]);

  useEffect(() => {
    dialogRef.current?.focus();
  }, [conflicts.length]);

  if (conflicts.length === 0) return null;

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Confirm saving with overlapping classes"
        className="w-full max-w-md rounded-card border border-border bg-background p-5"
      >
        <p className="text-sm font-medium text-foreground">
          This schedule has {conflicts.length} overlapping class
          {conflicts.length === 1 ? '' : 'es'}
        </p>
        <ul className="mt-2 space-y-0.5 text-xs text-text-secondary">
          {conflicts.map((c, i) => (
            <li key={i}>
              {c.a.label} overlaps {c.b.label} on {c.a.day}
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-text-tertiary">
          You can still save — UBC&apos;s timetable data can&apos;t always tell a real clash from
          an alternating-week pattern.
        </p>

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-pill border border-border px-4 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-surface-muted"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-pill bg-brand px-4 py-1.5 text-xs font-medium text-brand-foreground transition-colors hover:bg-brand-hover"
          >
            Save anyway
          </button>
        </div>
      </div>
    </div>
  );
}
