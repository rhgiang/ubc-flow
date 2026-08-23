'use client';

import { useEffect } from 'react';
import { useCourseDetail } from '@/components/schedule/course-info/useCourseDetail';
import CourseInfoContent from '@/components/schedule/course-info/CourseInfoContent';
import type { SectionHit } from '@/lib/search';

/**
 * Course detail as an overlay rather than a navigation, so a student deciding
 * between sections never loses their half-built schedule (spec §7).
 *
 * Detail is fetched the first time a course is opened and cached for the life
 * of the page — reopening is instant, and the builder's initial load carries
 * none of this.
 */
export default function CourseInfoOverlay({
  courseId,
  termId,
  addedSectionIds,
  onAddSection,
  onRemoveSection,
  onDock,
  onClose,
}: {
  courseId: string | null;
  termId: string;
  addedSectionIds: Set<string>;
  onAddSection?: (hit: SectionHit) => void;
  onRemoveSection?: (sectionId: string) => void;
  onDock: () => void;
  onClose: () => void;
}) {
  const { detail, loading } = useCourseDetail(courseId, termId);

  // Escape closes, matching the auth overlay.
  useEffect(() => {
    if (!courseId) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [courseId, onClose]);

  if (!courseId) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={detail ? `${detail.code} course information` : 'Course information'}
      className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/50 px-6 py-10 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-2xl rounded-card border border-border-hairline bg-surface p-6 shadow-lg">
        {loading && !detail && <p className="text-sm text-text-secondary">Loading course…</p>}
        {!loading && !detail && (
          <p className="text-sm text-text-secondary">Could not load this course.</p>
        )}

        {detail && (
          <>
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h2 className="text-xl font-semibold text-foreground">{detail.code}</h2>
                <p className="text-sm text-text-secondary">{detail.title}</p>
                {detail.credits !== null && (
                  <p className="mt-0.5 text-xs text-text-tertiary">{detail.credits} credits</p>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={onDock}
                  aria-label="Show this course beside the calendar"
                  title="Show beside the calendar"
                  className="shrink-0 rounded-full p-1 text-text-secondary hover:bg-surface-muted hover:text-foreground"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="h-5 w-5">
                    <rect x="3" y="4" width="18" height="16" rx="2" />
                    <path d="M15 4v16" />
                  </svg>
                </button>
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
            </div>

            <CourseInfoContent
              detail={detail}
              addedSectionIds={addedSectionIds}
              onAddSection={onAddSection}
              onRemoveSection={onRemoveSection}
            />
          </>
        )}
      </div>
    </div>
  );
}
