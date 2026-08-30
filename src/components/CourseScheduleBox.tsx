'use client';

import { useState } from 'react';
import Link from 'next/link';
import { formatMeeting } from '@/lib/format';
import { isUpcomingTerm } from '@/schedule/terms';

type SectionRow = {
  id: string;
  sectionCode: string;
  activity: string | null;
  /** Workday's registration state: Open, Waitlist, or Closed (i.e. full). */
  status: string | null;
  meetingTimes: { day: string; startTime: string | null; endTime: string | null; building: string | null; room: string | null }[];
  instructors: { instructorId: string; instructor: { name: string; slug: string } }[];
  term: { id: string; name: string; year: number; session: string; termNumber: number | null };
};

// The signed-in user's own saved schedules, for the "add this section" cell.
// Undefined (not an empty array) means signed out — that's what hides the
// column, same gating the old inline sections table used.
type ScheduleOption = { id: string; name: string; termId: string };

/**
 * Workday's registration state, in a student's words: "Closed" means the
 * section is full, so that is the word shown. Refreshed by the nightly
 * catalogue scrape (plus up to an hour of page cache) - guidance for
 * registration, not a live seat count, which is what the title says.
 */
function SectionStatus({ status }: { status: string | null }) {
  if (!status) return <span className="text-text-secondary">—</span>;
  const label = status === 'Closed' ? 'Full' : status;
  const tone =
    status === 'Closed'
      ? 'text-danger'
      : status === 'Waitlist'
        ? 'text-info'
        : 'text-text-secondary';
  return (
    <span title="As of the last daily catalogue refresh" className={tone}>
      {label}
    </span>
  );
}

export default function CourseScheduleBox({
  sections,
  mySchedules,
  addToScheduleActions,
}: {
  sections: SectionRow[];
  mySchedules?: ScheduleOption[];
  addToScheduleActions?: Record<string, (formData: FormData) => Promise<void>>;
}) {
  const [collapsed, setCollapsed] = useState(false);

  const upcoming = sections.filter((s) => isUpcomingTerm(s.term));
  const termGroups = new Map<string, { term: SectionRow['term']; rows: SectionRow[] }>();
  for (const s of upcoming) {
    const entry = termGroups.get(s.term.id) ?? { term: s.term, rows: [] };
    entry.rows.push(s);
    termGroups.set(s.term.id, entry);
  }
  const terms = [...termGroups.values()].sort(
    (a, b) => a.term.year - b.term.year || (a.term.termNumber ?? 0) - (b.term.termNumber ?? 0),
  );
  const [activeTermId, setActiveTermId] = useState<string | undefined>(terms[0]?.term.id);
  const active = terms.find((t) => t.term.id === activeTermId) ?? terms[0];

  return (
    <div className="rounded-card border border-border">
      <button
        type="button"
        onClick={() => setCollapsed(!collapsed)}
        className="flex w-full items-center justify-between p-4 text-left"
      >
        <p className="text-lg font-semibold text-foreground">Course Schedule</p>
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.75}
          className={`h-5 w-5 text-text-secondary transition-transform ${collapsed ? '' : 'rotate-180'}`}
        >
          <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {!collapsed && (
        <div className="border-t border-border">
          {terms.length === 0 ? (
            <p className="p-4 text-sm text-text-secondary">
              No sections scheduled for the current or upcoming terms.
            </p>
          ) : (
            <>
              <div className="flex overflow-x-auto border-b border-border">
                {terms.map(({ term }) => (
                  <button
                    key={term.id}
                    type="button"
                    onClick={() => setActiveTermId(term.id)}
                    className={`shrink-0 px-4 py-2 text-sm font-medium ${
                      active?.term.id === term.id
                        ? 'border-b-2 border-brand-accent text-foreground'
                        : 'text-text-secondary hover:text-foreground'
                    }`}
                  >
                    {term.name}
                  </button>
                ))}
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="text-xs text-text-secondary">
                    <tr>
                      <th className="px-4 py-2 font-medium">Section</th>
                      <th className="px-4 py-2 font-medium">Activity</th>
                      <th className="px-4 py-2 font-medium">Status</th>
                      <th className="px-4 py-2 font-medium">Time</th>
                      {/* ponytail: dropped on phones — the widest, least
                          decision-critical column; a card-per-row layout like
                          explore's is the upgrade if phones need instructors. */}
                      <th className="px-4 py-2 font-medium max-sm:hidden">Instructor</th>
                      {mySchedules && <th className="px-4 py-2 font-medium">Schedule</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {active?.rows.map((s) => {
                      const matchingSchedules = mySchedules?.filter((sc) => sc.termId === s.term.id) ?? [];
                      const addToSchedule = addToScheduleActions?.[s.id];
                      return (
                        <tr key={s.id} className="border-t border-border">
                          <td className="px-4 py-2 font-medium text-foreground">{s.sectionCode}</td>
                          <td className="px-4 py-2 text-text-secondary">{s.activity ?? '—'}</td>
                          <td className="px-4 py-2">
                            <SectionStatus status={s.status} />
                          </td>
                          <td className="px-4 py-2 text-text-secondary">
                            {s.meetingTimes.length ? s.meetingTimes.map((m) => formatMeeting(m)).join(', ') : '—'}
                          </td>
                          <td className="px-4 py-2 max-sm:hidden">
                            {s.instructors.length
                              ? s.instructors.map((si) => (
                                  <Link
                                    key={si.instructorId}
                                    href={`/professor/${si.instructor.slug}`}
                                    className="text-brand-accent hover:underline"
                                  >
                                    {si.instructor.name}
                                  </Link>
                                ))
                              : '—'}
                          </td>
                          {mySchedules && (
                            <td className="px-4 py-2">
                              {matchingSchedules.length > 0 && addToSchedule ? (
                                <form action={addToSchedule} className="flex items-center gap-1">
                                  {matchingSchedules.length > 1 ? (
                                    <select
                                      name="scheduleId"
                                      className="rounded border border-border px-1 py-0.5 text-xs"
                                    >
                                      {matchingSchedules.map((sc) => (
                                        <option key={sc.id} value={sc.id}>
                                          {sc.name}
                                        </option>
                                      ))}
                                    </select>
                                  ) : (
                                    <input type="hidden" name="scheduleId" value={matchingSchedules[0].id} />
                                  )}
                                  <button
                                    type="submit"
                                    className="inline-flex items-center text-xs text-brand-accent hover:underline pointer-coarse:min-h-11 pointer-coarse:px-2"
                                  >
                                    + Add
                                  </button>
                                </form>
                              ) : (
                                <Link href="/schedule" className="text-xs text-brand-accent hover:underline">
                                  Create a schedule
                                </Link>
                              )}
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
