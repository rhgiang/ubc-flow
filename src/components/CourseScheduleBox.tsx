'use client';

import { useState } from 'react';
import Link from 'next/link';
import { formatMeeting } from '@/lib/format';
import { isUpcomingTerm } from '@/schedule/terms';

type SectionRow = {
  id: string;
  sectionCode: string;
  activity: string | null;
  enrolTotal: number | null;
  enrolCap: number | null;
  meetingTimes: { day: string; startTime: string | null; endTime: string | null; building: string | null; room: string | null }[];
  instructors: { instructorId: string; instructor: { name: string; slug: string } }[];
  term: { id: string; name: string; year: number; session: string; termNumber: number | null };
};

export default function CourseScheduleBox({ sections }: { sections: SectionRow[] }) {
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
                      activeTermId === term.id
                        ? 'border-b-2 border-brand text-foreground'
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
                      <th className="px-4 py-2 font-medium">Enrolled</th>
                      <th className="px-4 py-2 font-medium">Time</th>
                      <th className="px-4 py-2 font-medium">Instructor</th>
                    </tr>
                  </thead>
                  <tbody>
                    {active?.rows.map((s) => (
                      <tr key={s.id} className="border-t border-border">
                        <td className="px-4 py-2 font-medium text-foreground">{s.sectionCode}</td>
                        <td className="px-4 py-2 text-text-secondary">{s.activity ?? '—'}</td>
                        <td className="px-4 py-2 text-text-secondary">
                          {s.enrolTotal !== null && s.enrolCap !== null
                            ? `${s.enrolTotal}/${s.enrolCap}`
                            : '—'}
                        </td>
                        <td className="px-4 py-2 text-text-secondary">
                          {s.meetingTimes.length ? s.meetingTimes.map((m) => formatMeeting(m)).join(', ') : '—'}
                        </td>
                        <td className="px-4 py-2">
                          {s.instructors.length
                            ? s.instructors.map((si) => (
                                <Link
                                  key={si.instructorId}
                                  href={`/professor/${si.instructor.slug}`}
                                  className="text-brand hover:underline"
                                >
                                  {si.instructor.name}
                                </Link>
                              ))
                            : '—'}
                        </td>
                      </tr>
                    ))}
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
