'use client';

import { useState } from 'react';
import Link from 'next/link';
import ScheduleRowActions from '@/components/ScheduleRowActions';
import ScheduleCalendar, { type CalendarEntry } from '@/components/schedule/ScheduleCalendar';

export type SectionLite = { id: string; label: string; href: string };
export type ScheduleRow = { id: string; name: string; sections: SectionLite[] };
export type TermGroup = { termId: string; termName: string; rows: ScheduleRow[] };
export type CalendarTermGroup = {
  termId: string;
  termName: string;
  entries: CalendarEntry[];
  /** True for at most one group: the term containing today (spec's current-time indicator). */
  isCurrentTerm: boolean;
};

const VISIBLE_SECTIONS = 3;
type Tab = 'upcoming' | 'past' | 'calendar';

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`border-b-2 pb-2 text-sm font-medium ${
        active ? 'border-brand text-brand' : 'border-transparent text-text-secondary'
      }`}
    >
      {children}
    </button>
  );
}

function SectionList({ sections }: { sections: SectionLite[] }) {
  if (sections.length === 0) {
    return <span className="text-sm text-text-tertiary">No sections added</span>;
  }
  const shown = sections.slice(0, VISIBLE_SECTIONS);
  const rest = sections.slice(VISIBLE_SECTIONS);

  return (
    <div className="space-y-1">
      {shown.map((s) => (
        <Link key={s.id} href={s.href} className="block truncate text-sm text-brand hover:underline">
          {s.label}
        </Link>
      ))}
      {rest.length > 0 && (
        <details>
          <summary className="cursor-pointer text-xs text-text-tertiary">More ({rest.length})</summary>
          <div className="mt-1 space-y-1">
            {rest.map((s) => (
              <Link key={s.id} href={s.href} className="block truncate text-sm text-brand hover:underline">
                {s.label}
              </Link>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

function TermTable({ group, first }: { group: TermGroup; first: boolean }) {
  return (
    <div className={first ? '' : 'mt-6'}>
      <h3 className="text-sm font-medium text-foreground">{group.termName}</h3>
      <div className="mt-2 rounded-card border border-border">
        <div className="flex items-center justify-between rounded-t-card border-b border-border bg-surface-muted px-4 py-2 text-xs text-text-tertiary">
          <span>Saved Schedules</span>
          <span>
            {group.rows.length} item{group.rows.length === 1 ? '' : 's'}
          </span>
        </div>
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-border text-xs text-text-tertiary">
              <th className="w-1/3 px-4 py-2 font-medium">Saved Schedule</th>
              <th className="px-4 py-2 font-medium">Course Sections</th>
              <th className="w-10 px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {group.rows.map((s) => (
              <tr key={s.id} className="border-b border-border last:border-b-0">
                <td className="px-4 py-3 align-top">
                  <Link href={`/schedule/${s.id}`} className="font-medium text-brand hover:underline">
                    {s.name}
                  </Link>
                </td>
                <td className="px-4 py-3 align-top">
                  <SectionList sections={s.sections} />
                </td>
                <td className="px-4 py-3 align-top">
                  <ScheduleRowActions scheduleId={s.id} name={s.name} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CalendarTerm({ group, first }: { group: CalendarTermGroup; first: boolean }) {
  return (
    <div className={first ? '' : 'mt-8'}>
      <h3 className="text-sm font-medium text-foreground">{group.termName}</h3>
      {group.entries.length === 0 ? (
        <p className="mt-2 text-sm text-text-tertiary">
          No enrolled courses on record for this term — upload your Workday export from Account.
        </p>
      ) : (
        <div className="mt-2">
          <ScheduleCalendar entries={group.entries} showNowIndicator={group.isCurrentTerm} />
        </div>
      )}
    </div>
  );
}

export default function ScheduleTabs({
  program,
  upcoming,
  past,
  calendar,
}: {
  program: string | null;
  upcoming: TermGroup[];
  past: TermGroup[];
  calendar: CalendarTermGroup[];
}) {
  const [tab, setTab] = useState<Tab>('upcoming');
  const groups = tab === 'upcoming' ? upcoming : past;

  return (
    <div className="mt-8">
      <div className="flex gap-6 border-b border-border">
        <TabButton active={tab === 'upcoming'} onClick={() => setTab('upcoming')}>
          Upcoming Saved Schedules
        </TabButton>
        <TabButton active={tab === 'past'} onClick={() => setTab('past')}>
          Past Saved Schedules
        </TabButton>
        <TabButton active={tab === 'calendar'} onClick={() => setTab('calendar')}>
          View Calendar
        </TabButton>
      </div>

      <div className="mt-6">
        {tab === 'calendar' ? (
          calendar.map((g, i) => <CalendarTerm key={g.termId} group={g} first={i === 0} />)
        ) : (
          <>
            {program && <p className="mb-2 font-semibold text-foreground">{program}</p>}
            {groups.length === 0 ? (
              <p className="text-text-secondary">
                {tab === 'upcoming'
                  ? 'No upcoming saved schedules yet — create one above.'
                  : 'No past saved schedules.'}
              </p>
            ) : (
              groups.map((g, i) => <TermTable key={g.termId} group={g} first={i === 0} />)
            )}
          </>
        )}
      </div>
    </div>
  );
}
