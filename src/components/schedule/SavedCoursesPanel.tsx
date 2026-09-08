'use client';

import { groupSectionsByCourse } from '@/schedule/group';
import { courseColorIndex } from '@/schedule/colors';
import CourseHeaderActions from '@/components/schedule/CourseHeaderActions';
import SectionStatus from '@/components/schedule/SectionStatus';
import type { SectionHit } from '@/lib/search';

export default function SavedCoursesPanel({
  chosen,
  onRemove,
  onInfo,
  onDock,
  onSwap,
}: {
  chosen: SectionHit[];
  onRemove: (sectionId: string) => void;
  onInfo: (courseId: string) => void;
  onDock: (courseId: string) => void;
  onSwap?: (section: SectionHit) => void;
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
          // overflow-hidden so the tinted header below is clipped to the
          // card's rounded corners instead of squaring them off.
          return (
          <details key={group.code} open className="overflow-hidden rounded-card border border-border">
            {/* flex, not inline-flex: the header band has to span the card's
                full width for the tint to read as a header rather than a
                patch behind the text. Same --surface the explore table
                stripes with, so the two surfaces match. */}
            <summary className="flex cursor-pointer items-center gap-2 bg-surface px-3 py-2">
              <span
                aria-hidden
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ background: `var(--course-${slot}-accent)` }}
              />
              <span className="text-sm font-medium text-foreground">{group.code}</span>
              <span className="text-xs text-text-secondary">{group.title}</span>
              <CourseHeaderActions
                code={group.code}
                slot={slot}
                onInfo={() => onInfo(group.courseId)}
                onDock={() => onDock(group.courseId)}
                onSwap={onSwap ? () => onSwap(group.sections[0]) : undefined}
              />
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
                    <SectionStatus status={section.status} />
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
