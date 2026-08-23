'use client';

import { useEffect, useRef } from 'react';
import CourseInfoContent from '@/components/schedule/course-info/CourseInfoContent';
import { useCourseDetail } from '@/components/schedule/course-info/useCourseDetail';
import type { SectionHit } from '@/lib/search';

/**
 * The course overlay, docked beside the calendar instead of covering it, so a
 * student can keep a course open while they build.
 *
 * Shares CourseInfoContent and the module-scope cache with the modal, so
 * popping out and back in never refetches.
 */
export default function CourseInfoPanel({
  courseId,
  termId,
  addedSectionIds,
  onAddSection,
  onRemoveSection,
  onExpand,
  onClose,
}: {
  courseId: string;
  termId: string;
  addedSectionIds: Set<string>;
  onAddSection?: (hit: SectionHit) => void;
  onRemoveSection?: (sectionId: string) => void;
  onExpand: () => void;
  onClose: () => void;
}) {
  const { detail, loading } = useCourseDetail(courseId, termId);
  const panelRef = useRef<HTMLElement>(null);
  useEffect(() => {
    panelRef.current?.focus();
  }, [courseId]);

  return (
    <aside
      ref={panelRef}
      tabIndex={-1}
      aria-label={detail ? `${detail.code} course information` : 'Course information'}
      className="flex w-full shrink-0 flex-col overflow-y-auto border-t border-border lg:w-[380px] lg:border-l lg:border-t-0"
    >
      <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-border bg-surface px-4 py-3">
        <div className="min-w-0">
          {detail ? (
            <>
              <p className="truncate text-sm font-semibold text-foreground">{detail.code}</p>
              <p className="truncate text-xs text-text-secondary">{detail.title}</p>
            </>
          ) : (
            <p className="text-sm text-text-secondary">
              {loading ? 'Loading course…' : 'Could not load this course.'}
            </p>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={onExpand}
            aria-label="Expand this course to a full window"
            title="Expand"
            className="rounded-full p-1 text-text-secondary hover:bg-surface-muted hover:text-foreground"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="h-4 w-4">
              <path d="M4 14v6h6M20 10V4h-6M20 4l-7 7M4 20l7-7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close course information"
            className="rounded-full p-1 text-text-secondary hover:bg-surface-muted hover:text-foreground"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="h-4 w-4">
              <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </div>

      {detail && (
        <div className="px-4 py-3">
          <CourseInfoContent
            detail={detail}
            addedSectionIds={addedSectionIds}
            onAddSection={onAddSection}
            onRemoveSection={onRemoveSection}
          />
        </div>
      )}
    </aside>
  );
}
