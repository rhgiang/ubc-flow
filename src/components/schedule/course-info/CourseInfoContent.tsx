'use client';

import Link from 'next/link';
import GradeChart from '@/components/GradeChart';
import HistoricalGradesTimeline from '@/components/HistoricalGradesTimeline';
import RequirementTree from '@/components/RequirementTree';
import type { CourseDetail, CourseSectionDetail } from '@/lib/course-detail';
import type { SectionHit } from '@/lib/search';

/** The overlay's own section shape widened back to the builder's SectionHit,
 *  so a section added here is indistinguishable from one added via search. */
function toHit(detail: CourseDetail, s: CourseSectionDetail): SectionHit {
  return {
    sectionId: s.sectionId,
    courseId: detail.courseId,
    code: detail.code,
    title: detail.title,
    sectionCode: s.sectionCode,
    activity: s.activity,
    meetings: s.meetings,
    meetingTimes: s.meetingTimes,
  };
}

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

/** "DMP 310, HENN 202" — de-duplicated, since a section's meetings often repeat a room. */
function locationLabel(s: CourseSectionDetail): string | null {
  const places = [
    ...new Set(
      s.meetingTimes
        .filter((m) => m.building)
        .map((m) => `${m.building}${m.room ? ` ${m.room}` : ''}`),
    ),
  ];
  return places.length > 0 ? places.join(', ') : null;
}

export default function CourseInfoContent({
  detail,
  addedSectionIds,
  onAddSection,
  onRemoveSection,
}: {
  detail: CourseDetail;
  addedSectionIds: Set<string>;
  onAddSection?: (hit: SectionHit) => void;
  onRemoveSection?: (sectionId: string) => void;
}) {
  return (
    <>
      {detail.description && (
        <p className="mt-4 text-sm text-text-secondary">{detail.description}</p>
      )}

      <section className="mt-6">
        <h3 className="text-sm font-semibold text-foreground">Sections this term</h3>
        {detail.sections.length === 0 ? (
          <p className="mt-2 text-sm text-text-secondary">
            Not offered in the term you&apos;re planning.
          </p>
        ) : (
          <ul className="mt-2 divide-y divide-border rounded-card border border-border">
            {detail.sections.map((s) => {
              const added = addedSectionIds.has(s.sectionId);
              const location = locationLabel(s);
              return (
                <li key={s.sectionId} className="flex items-start justify-between gap-3 px-3 py-2">
                  <div className="min-w-0">
                    <p className="text-sm text-foreground">
                      {s.sectionCode}
                      {s.activity && (
                        <span className="ml-2 text-xs text-text-secondary">{s.activity}</span>
                      )}
                    </p>
                    <p className="text-xs text-text-tertiary">{s.meetings}</p>
                    {location && (
                      <p className="text-xs text-text-tertiary">{location}</p>
                    )}
                    {s.instructors.length > 0 && (
                      <p className="text-xs text-text-secondary">
                        {s.instructors.map((i, idx) => (
                          <span key={i.slug}>
                            {idx > 0 && ', '}
                            <Link
                              href={`/professor/${i.slug}`}
                              className="text-brand-accent hover:underline"
                            >
                              {i.name}
                            </Link>
                          </span>
                        ))}
                      </p>
                    )}
                    {s.enrolCap !== null && (
                      <p className="text-xs text-text-tertiary">
                        {s.enrolTotal ?? 0} / {s.enrolCap} enrolled
                      </p>
                    )}
                  </div>
                  {(onAddSection || onRemoveSection) && (
                    <button
                      type="button"
                      onClick={() =>
                        added
                          ? onRemoveSection?.(s.sectionId)
                          : onAddSection?.(toHit(detail, s))
                      }
                      aria-label={`${added ? 'Remove' : 'Add'} ${detail.code} ${s.sectionCode}`}
                      className="shrink-0 rounded-pill border border-border px-3 py-1 text-xs font-medium text-foreground transition-colors hover:bg-surface-muted"
                    >
                      {added ? 'Remove' : 'Add'}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="mt-6">
        <h3 className="text-sm font-semibold text-foreground">Grades</h3>
        {detail.grades.sectionCount === 0 ? (
          <p className="mt-2 text-sm text-text-secondary">No grade data for this course yet.</p>
        ) : (
          <>
            <div className="mt-2 grid grid-cols-3 gap-2">
              <Stat label="Average" value={pct(detail.grades.average)} />
              <Stat label="Students" value={String(detail.grades.studentCount)} />
              <Stat label="Sections" value={String(detail.grades.sectionCount)} />
            </div>
            <div className="mt-3">
              <GradeChart distribution={detail.grades.distribution} />
            </div>
          </>
        )}

        {detail.historical && (
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Stat label="All-time avg" value={pct(detail.historical.average)} />
            <Stat label="Past 5 years" value={pct(detail.historical.averagePast5Years)} />
            <Stat label="Std dev" value={
              detail.historical.stddev !== null ? detail.historical.stddev.toFixed(1) : '—'
            } />
          </div>
        )}

        {detail.historicalByTerm.length > 0 && (
          <div className="mt-3">
            <HistoricalGradesTimeline terms={detail.historicalByTerm} />
          </div>
        )}
      </section>

      {(detail.prereqTree || detail.coreqTree || detail.prereqText || detail.coreqText) && (
        <section className="mt-6">
          <h3 className="text-sm font-semibold text-foreground">Requirements</h3>
          <div className="mt-2 space-y-3 text-sm text-text-secondary">
            {detail.prereqTree ? (
              <div>
                <p className="text-xs font-medium text-text-tertiary">Prerequisites</p>
                <RequirementTree node={detail.prereqTree} />
              </div>
            ) : (
              detail.prereqText && (
                <div>
                  <p className="text-xs font-medium text-text-tertiary">Prerequisites</p>
                  <p>{detail.prereqText}</p>
                </div>
              )
            )}
            {detail.coreqTree ? (
              <div>
                <p className="text-xs font-medium text-text-tertiary">Corequisites</p>
                <RequirementTree node={detail.coreqTree} />
              </div>
            ) : (
              detail.coreqText && (
                <div>
                  <p className="text-xs font-medium text-text-tertiary">Corequisites</p>
                  <p>{detail.coreqText}</p>
                </div>
              )
            )}
          </div>
        </section>
      )}

      <Link
        href={detail.href}
        className="mt-6 inline-block text-sm font-medium text-brand-accent hover:underline"
      >
        View full course page →
      </Link>
    </>
  );
}
