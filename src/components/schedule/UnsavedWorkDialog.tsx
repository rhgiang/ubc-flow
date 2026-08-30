'use client';

import { useEffect, useRef } from 'react';

/**
 * Asked before a navigation that would drop buffered edits.
 *
 * A three-way choice rather than window.confirm's two: the common case after a
 * multi-term Workday import is that the student wants BOTH schedules, so
 * "leave without saving?" forces them to either lose the first one or cancel
 * and hunt for the Save button themselves.
 */
export default function UnsavedWorkDialog({
  name,
  saving,
  canSave,
  onSave,
  onDiscard,
  onCancel,
}: {
  name: string;
  saving: boolean;
  /** False when the schedule can't be saved as it stands (no name, no sections). */
  canSave: boolean;
  onSave: () => void;
  onDiscard: () => void;
  onCancel: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onCancel();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);

  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  const label = name.trim() || 'This schedule';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Unsaved changes"
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 px-6 backdrop-blur-sm"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="w-full max-w-md rounded-card border border-border-hairline bg-surface p-6 shadow-lg"
      >
        <h2 className="text-base font-semibold text-foreground">Save before you switch?</h2>
        <p className="mt-2 text-sm text-text-secondary">
          {label} has changes you haven&apos;t saved. Leaving now discards them.
        </p>

        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-pill border border-border px-4 py-2 text-sm font-medium text-foreground transition duration-150 ease-out hover:scale-[1.02] hover:bg-surface-muted active:scale-100"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onDiscard}
            className="rounded-pill border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:border-danger-border hover:bg-danger-surface hover:text-danger"
          >
            Discard and switch
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={!canSave || saving}
            title={!canSave ? 'Name the schedule and add a section before saving' : undefined}
            className="rounded-pill bg-brand px-4 py-2 text-sm font-medium text-brand-foreground transition-colors hover:bg-brand-hover disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save and switch'}
          </button>
        </div>
      </div>
    </div>
  );
}
