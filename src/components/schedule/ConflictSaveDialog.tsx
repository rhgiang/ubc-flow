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
      // "save and switch" flow), and both listen for keydown on `document` —
      // the SAME node. One Escape would otherwise fire both onCancel handlers,
      // backing out of this confirmation AND silently discarding the parked
      // navigation underneath it.
      //
      // Two details make this work, and neither is optional. stopPropagation
      // is useless here: it halts traversal to the next node, and these
      // listeners share one. And stopImmediatePropagation alone is not enough
      // either, because it only suppresses listeners registered AFTER it —
      // UnsavedWorkDialog mounts first, so its listener already sits ahead in
      // the queue. Listening in the capture phase is what puts this handler in
      // front: capture reaches `document` on the way down to the focused
      // element, before any bubble-phase listener on that same node.
      e.stopImmediatePropagation();
      onCancel();
    }
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [conflicts.length, onCancel]);

  useEffect(() => {
    dialogRef.current?.focus();
  }, [conflicts.length]);

  if (conflicts.length === 0) return null;

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
          You can still save. UBC&apos;s timetable data cannot always tell a real clash from
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
