'use client';

import { useEffect, useRef } from 'react';
import { courseColorIndex } from '@/schedule/colors';
import { AmbiguousSectionNote, formatAlphaSplit, formatDate, sourceLabel } from '@/components/ExamList';
import type { ExamListItem } from '@/schedule/exams';

/**
 * One exam's full detail, as an overlay rather than a navigation — the same
 * chrome, backdrop, Escape handling and close button as CourseInfoOverlay, so
 * the two read as the same app.
 *
 * Purely presentational: everything it shows is already in the group handed to
 * it. CourseInfoOverlay's API is built around adding and removing sections
 * while building a schedule, which an exam has no equivalent of, so this is
 * its own component rather than a widened version of that one.
 *
 * `group` is one exam — several rows when UBC splits it across rooms by
 * surname (see `groupExams`). The list and the calendar both hand over the
 * same grouped shape.
 */
export default function ExamDetailOverlay({
  group,
  onClose,
}: {
  group: ExamListItem[] | null;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);

  // Escape closes, matching CourseInfoOverlay and the auth overlay.
  useEffect(() => {
    if (!group) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [group, onClose]);

  // Focus moves into the dialog on open and back to whatever opened it on
  // close — the trigger is a chip in a month grid, and dropping focus on
  // <body> would send the next Tab to the top of the page.
  useEffect(() => {
    if (!group) return;
    const trigger = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    return () => trigger?.focus();
  }, [group]);

  if (!group) return null;

  const item = group[0];
  const slot = courseColorIndex(item.courseLabel);
  const when = `${item.date ? formatDate(item.date) : 'Date to be announced'}${
    item.startTime ? ` · ${item.startTime}` : ''
  }`;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${item.courseLabel} exam details`}
      className="fixed inset-0 z-[60] flex items-start justify-center overlay-below-nav overflow-y-auto bg-black/50 px-6 pb-10 backdrop-blur-sm"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        style={{ boxShadow: `inset 4px 0 0 0 var(--course-${slot}-accent)` }}
        className="w-full max-w-md rounded-card border border-border-hairline bg-surface p-6 shadow-lg"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2
              className="text-xl font-semibold"
              style={{ color: `var(--course-${slot}-accent)` }}
            >
              {item.courseLabel}
            </h2>
            <p className="text-sm text-text-secondary">
              {item.kind === 'final' ? 'Final exam' : 'Midterm'}
              {item.sectionCode ? ` · Section ${item.sectionCode}` : ''}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded-full p-1 text-text-secondary hover:bg-surface-muted hover:text-foreground"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="h-5 w-5">
              <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* Above the details, and outside the strike-through: which section
            this is decides whether any of them apply to the student. */}
        {item.ambiguousSection && (
          <div className="mt-4">
            <AmbiguousSectionNote />
          </div>
        )}

        {item.cancelled && (
          <p className="mt-4 rounded-input border border-danger-border bg-danger-surface px-2 py-1 text-sm font-medium text-danger">
            Cancelled
          </p>
        )}

        {/* A cancelled exam keeps every detail on screen, struck through — the
            same treatment its card gets in the list. Hiding the date of an
            exam that was pulled is how someone shows up for it anyway. */}
        <dl className={`mt-4 space-y-3 ${item.cancelled ? 'line-through decoration-2 opacity-70' : ''}`}>
          <div>
            <dt className="text-xs text-text-tertiary">When</dt>
            <dd className="text-sm text-foreground">{when}</dd>
          </div>

          <div>
            <dt className="text-xs text-text-tertiary">
              {group.length > 1 ? 'Where — find your surname' : 'Where'}
            </dt>
            {group.length === 1 ? (
              <dd className="text-sm text-foreground">
                {item.location ?? 'Location TBA — check with your instructor'}
                {item.alphaSplit ? ` · ${formatAlphaSplit(item.alphaSplit)}` : ''}
              </dd>
            ) : (
              // UBC splits a big exam across rooms by surname and publishes a
              // row per room. The surname range is what tells a student which
              // room is theirs, so it leads.
              <dd>
                <ul className="space-y-1">
                  {group.map((row) => (
                    <li key={row.id} className="text-sm text-foreground">
                      <span className="text-text-secondary">
                        {row.alphaSplit ? `${formatAlphaSplit(row.alphaSplit)}: ` : ''}
                      </span>
                      {row.location ?? 'Location TBA'}
                    </li>
                  ))}
                </ul>
              </dd>
            )}
          </div>

          {item.notes && (
            <div>
              <dt className="text-xs text-text-tertiary">Note</dt>
              <dd className="text-sm text-text-secondary">{item.notes}</dd>
            </div>
          )}
        </dl>

        <p className="mt-4 border-t border-border-hairline pt-3 text-xs text-text-tertiary">
          {sourceLabel(item)}
        </p>
      </div>
    </div>
  );
}
