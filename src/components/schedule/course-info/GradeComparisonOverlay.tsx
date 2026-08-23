'use client';

import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import GradeChart from '@/components/GradeChart';
import HistoricalGradesTimeline from '@/components/HistoricalGradesTimeline';
import type { CourseDetail, InstructorGradeHistory } from '@/lib/course-detail';

/** "+2.6%" / "-1.4%" — the sign is the point, so a positive delta keeps its "+". */
export function formatDelta(instructorAverage: number, courseAverage: number): string {
  const delta = instructorAverage - courseAverage;
  return `${delta >= 0 ? '+' : ''}${delta.toFixed(1)}%`;
}

/** Local copy rather than importing from CourseInfoContent, which imports this
 *  file — the two would form an import cycle. It is five lines of markup. */
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-card border border-border px-3 py-2">
      <p className="text-xs text-text-tertiary">{label}</p>
      <p className="mt-0.5 text-sm font-medium text-foreground">{value}</p>
    </div>
  );
}

function pct(v: number | null): string {
  return v !== null ? `${v.toFixed(1)}%` : '—';
}

/**
 * Course grades beside one instructor's, so a "+2.6%" is legible as a shape and
 * not just a number: an instructor can sit above the course average because they
 * give more As, or because they give fewer Ds — the two distributions say which.
 *
 * Always a centred modal, even when the course panel is docked: a two-column
 * comparison cannot be read in the dock's 380px.
 */
export default function GradeComparisonOverlay({
  detail,
  instructorName,
  grades,
  onClose,
}: {
  detail: CourseDetail;
  instructorName: string;
  grades: InstructorGradeHistory;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);

  // Capture phase + stopPropagation: the course overlay underneath also closes
  // on Escape from a document listener, and without this one keypress would
  // dismiss both.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      onClose();
    }
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  const courseAverage = detail.courseAverage;

  // Portalled to <body> because the course overlay this is opened from carries
  // `backdrop-blur`, and a backdrop-filter makes that element the containing
  // block for `position: fixed` descendants. Nested inside it, this dialog
  // resolved `inset-0` against the overlay's SCROLLING box and drifted with it,
  // sliding the scrim off the un-blurred content underneath. A portal also
  // stops any future transform or filter above from re-breaking it.
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${detail.code} grades compared with ${instructorName}`}
      className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto bg-black/50 px-6 py-10 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="w-full max-w-3xl rounded-card border border-border-hairline bg-surface p-6 shadow-lg"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-foreground">
              {detail.code} · {instructorName}
            </h2>
            <p className="text-sm text-text-secondary">
              {courseAverage !== null ? (
                <>
                  <span className="font-medium text-foreground">
                    {formatDelta(grades.average, courseAverage)}
                  </span>{' '}
                  versus the course average
                </>
              ) : (
                'No course-wide average to compare against.'
              )}
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

        <div className="mt-5 grid gap-6 sm:grid-cols-2">
          <section>
            <h3 className="text-sm font-semibold text-foreground">Course</h3>
            <p className="text-xs text-text-tertiary">All instructors, all terms</p>
            <div className="mt-2 grid grid-cols-3 gap-2">
              <Stat label="Average" value={pct(detail.grades.average)} />
              <Stat label="Students" value={String(detail.grades.studentCount)} />
              <Stat label="Sections" value={String(detail.grades.sectionCount)} />
            </div>
            <div className="mt-3">
              <GradeChart distribution={detail.grades.distribution} />
            </div>
            {detail.historicalByTerm.length > 0 && (
              <div className="mt-4">
                <p className="text-xs font-medium text-text-tertiary">Course average by term</p>
                <div className="mt-1">
                  <HistoricalGradesTimeline terms={detail.historicalByTerm} />
                </div>
              </div>
            )}
          </section>

          <section>
            <h3 className="truncate text-sm font-semibold text-foreground">{instructorName}</h3>
            <p className="text-xs text-text-tertiary">This course only</p>
            <div className="mt-2 grid grid-cols-3 gap-2">
              <Stat label="Average" value={pct(grades.average)} />
              <Stat label="Students" value={String(grades.students)} />
              <Stat
                label={grades.offerings === 1 ? 'Term' : 'Terms'}
                value={String(grades.offerings)}
              />
            </div>
            <div className="mt-3">
              <GradeChart distribution={grades.distribution} />
            </div>
            {grades.coTaught && (
              <p className="mt-3 text-xs text-text-tertiary">
                Some of these offerings were co-taught, so the grades are shared with
                another instructor.
              </p>
            )}
          </section>
        </div>

        <p className="mt-5 text-xs text-text-tertiary">
          Both charts come from UBC&apos;s published per-section grade data. The course side
          covers every instructor and term; this instructor&apos;s side covers only the terms
          they taught it, so the two are not drawn from the same students. Each chart is
          scaled to its own tallest bar — compare the shape of the distributions, not the
          pixel heights.
        </p>
      </div>
    </div>,
    document.body,
  );
}
