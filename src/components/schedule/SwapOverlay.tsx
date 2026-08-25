'use client';

import { useEffect, useRef } from 'react';
import FindCoursesPanel from '@/components/schedule/FindCoursesPanel';
import type { SectionHit } from '@/lib/search';

/**
 * Replace one held section with another.
 *
 * Opens on the held course's other sections because that is the common case,
 * but the search stays live: picking an unrelated course still removes the
 * original, because the action is "replace this", not "add another".
 */
export default function SwapOverlay({
  section,
  termId,
  addedIds,
  onSwap,
  onClose,
}: {
  section: SectionHit | null;
  termId: string;
  addedIds: Set<string>;
  onSwap: (next: SectionHit) => void;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);

  // Escape closes, matching CourseInfoOverlay and the auth overlay.
  useEffect(() => {
    if (!section) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [section, onClose]);

  useEffect(() => {
    dialogRef.current?.focus();
  }, [section]);

  if (!section) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center bg-black/50 p-4 sm:p-8"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
        aria-modal="true"
        aria-label={`Swap ${section.code} ${section.sectionCode}`}
        className="flex max-h-full w-full max-w-lg flex-col overflow-hidden rounded-card border border-border bg-background"
      >
        <div className="flex items-start justify-between gap-3 border-b border-border p-4">
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">
              Swap {section.code} {section.sectionCode}
            </p>
            {/* The section being replaced stays visible while choosing. */}
            <p className="mt-0.5 text-xs text-text-secondary">{section.meetings}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cancel swap"
            className="shrink-0 rounded-pill border border-border px-3 py-1 text-xs font-medium text-foreground transition-colors hover:bg-surface-muted"
          >
            Cancel
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <FindCoursesPanel
            termId={termId}
            addedIds={addedIds}
            onAdd={onSwap}
            initialQuery={section.code}
            actionLabel="Swap"
            currentSectionId={section.sectionId}
          />
        </div>
      </div>
    </div>
  );
}
