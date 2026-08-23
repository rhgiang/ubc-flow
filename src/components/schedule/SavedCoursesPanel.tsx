'use client';

import { groupSectionsByCourse } from '@/schedule/group';
import { courseColorIndex } from '@/schedule/colors';
import type { SectionHit } from '@/lib/search';

export default function SavedCoursesPanel({
  chosen,
  onRemove,
  onInfo,
}: {
  chosen: SectionHit[];
  onRemove: (sectionId: string) => void;
  onInfo: (courseId: string) => void;
}) {
  const groups = groupSectionsByCourse(chosen);

  if (groups.length === 0) {
    return (
      <div className="p-4">
        <p className="text-sm text-text-secondary">
          No courses yet. Use <span className="font-medium text-foreground">Find Courses</span> to
          add sections.
        </p>
      </div>
    );
  }

  return (
    <div className="p-4">
      <p className="text-sm font-medium text-foreground">Total Courses: {groups.length}</p>

      <div className="mt-3 space-y-2">
        {groups.map((group) => {
          const slot = courseColorIndex(group.code);
          return (
          <details key={group.code} open className="rounded-card border border-border">
            <summary className="inline-flex cursor-pointer items-center gap-2 px-3 py-2">
              <span
                aria-hidden
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ background: `var(--course-${slot}-accent)` }}
              />
              <span className="text-sm font-medium text-foreground">{group.code}</span>
              <span className="text-xs text-text-secondary">{group.title}</span>
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onInfo(group.courseId);
                }}
                aria-label={`Course information for ${group.code}`}
                style={{ borderColor: `var(--course-${slot}-accent)`, color: `var(--course-${slot}-accent)` }}
                className="ml-2 rounded-full border px-1.5 text-xs transition-colors hover:bg-surface-muted"
              >
                i
              </button>
            </summary>

            <ul className="border-t border-border">
              {group.sections.map((section) => (
                <li
                  key={section.sectionId}
                  className="flex items-start justify-between gap-2 border-b border-border px-3 py-2 last:border-b-0"
                >
                  <div className="min-w-0">
                    <p className="text-sm text-foreground">{section.sectionCode}</p>
                    <p className="text-xs text-text-secondary">{section.activity ?? '—'}</p>
                    <p className="text-xs text-text-tertiary">{section.meetings}</p>
                    {section.instructors.length > 0 && (
                      <p className="truncate text-xs text-text-tertiary">
                        {section.instructors.join(', ')}
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => onRemove(section.sectionId)}
                    aria-label={`Remove ${group.code} ${section.sectionCode}`}
                    className="shrink-0 rounded-pill border border-border px-3 py-1 text-xs font-medium text-foreground transition duration-150 ease-out hover:scale-[1.02] hover:bg-surface-muted active:scale-100"
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          </details>
          );
        })}
      </div>
    </div>
  );
}
