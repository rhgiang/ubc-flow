'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { courseColorIndex } from '@/schedule/colors';
import { AmbiguousSectionNote, formatAlphaSplit, formatDate, sourceLabel } from '@/components/ExamList';
import type { ExamListItem } from '@/schedule/exams';

/**
 * One exam's full detail, as an overlay rather than a navigation - the same
 * chrome, backdrop, Escape handling and close button as CourseInfoOverlay, so
 * the two read as the same app.
 *
 * Purely presentational: everything it shows is already in the group handed to
 * it. CourseInfoOverlay's API is built around adding and removing sections
 * while building a schedule, which an exam has no equivalent of, so this is
 * its own component rather than a widened version of that one.
 *
 * `group` is one exam - several rows when UBC splits it across rooms by
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
  const router = useRouter();
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
  // close - the trigger is a chip in a month grid, and dropping focus on
  // <body> would send the next Tab to the top of the page.
  useEffect(() => {
    if (!group) return;
    const trigger = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    return () => trigger?.focus();
  }, [group]);

  // The group is the exam, so removing it removes every row of it - a final
  // split across four rooms by surname is one exam, not four.
  async function remove(rows: ExamListItem[]) {
    setRemoving(true);
    setError(null);
    try {
      const ids = rows.map((r) => r.id).join(',');
      const res = await fetch(`/api/exams?source=${rows[0].source}&ids=${encodeURIComponent(ids)}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(data?.error ?? 'Could not remove that exam.');
        return;
      }
      onClose();
      router.refresh();
    } catch {
      setError('Could not remove that exam. Check your connection and try again.');
    } finally {
      setRemoving(false);
    }
  }

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

        {/* A cancelled exam keeps every detail on screen, struck through - the
            same treatment its card gets in the list. Hiding the date of an
            exam that was pulled is how someone shows up for it anyway. */}
        <dl className={`mt-4 space-y-3 ${item.cancelled ? 'line-through decoration-2 opacity-70' : ''}`}>
          <div>
            <dt className="text-xs text-text-tertiary">When</dt>
            <dd className="text-sm text-foreground">{when}</dd>
          </div>

          <div>
            <dt className="text-xs text-text-tertiary">
              {group.length > 1 ? 'Where to go, by surname' : 'Where'}
            </dt>
            {group.length === 1 ? (
              <dd className="text-sm text-foreground">
                {item.location ?? 'Location TBA. Check with your instructor.'}
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

        <div className="mt-4 border-t border-border-hairline pt-3">
          <p className="text-xs text-text-tertiary">{sourceLabel(item)}</p>

          {error && (
            <p role="alert" className="mt-2 text-sm text-danger">
              {error}
            </p>
          )}

          {/* Remove lives here because this overlay is the one place both
              views already lead to: a card in the list and a chip in the
              calendar open the same dialog on the same exam. */}
          <p className="mt-3 text-xs text-text-tertiary">
            {item.source === 'ubc'
              ? 'UBC publishes this exam for everyone in the course, so it cannot be deleted. Hiding it changes your view only, and Hidden exams under the list brings it back.'
              : 'This one is yours. Removing it deletes it from your exams.'}
          </p>
          {/* ponytail: no confirm step. The scraped one is reversible from the
              list, and the student typed the other one. Add a confirm if
              anyone actually reports losing an exam to a stray click. */}
          <button
            type="button"
            disabled={removing}
            onClick={() => remove(group)}
            className="mt-2 text-sm font-medium text-danger hover:underline disabled:opacity-50"
          >
            {removing
              ? 'Removing…'
              : item.source === 'ubc'
                ? 'Hide this exam'
                : 'Remove this exam'}
          </button>
        </div>
      </div>
    </div>
  );
}
