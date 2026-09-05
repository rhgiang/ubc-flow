'use client';

import { useState } from 'react';
import Link from 'next/link';
import ScheduleRowActions from '@/components/ScheduleRowActions';
import ScheduleCalendar, { type CalendarEntry } from '@/components/schedule/ScheduleCalendar';
import CourseInfoOverlay from '@/components/schedule/CourseInfoOverlay';
import CalendarSubscribeMenu from '@/components/schedule/CalendarSubscribeMenu';
import ShareLinkMenu from '@/components/schedule/ShareLinkMenu';
import {
  getEnrolledSubscribeUrl,
  enableEnrollmentSharing,
  disableEnrollmentSharing,
} from '@/app/actions/schedule';

export type SectionLite = { id: string; label: string; href: string };
export type ScheduleRow = { id: string; name: string; sections: SectionLite[] };
export type TermGroup = { termId: string; termName: string; rows: ScheduleRow[] };
export type CalendarTermGroup = {
  termId: string;
  termName: string;
  entries: CalendarEntry[];
  /** True for at most one group: the term containing today (spec's current-time indicator). */
  isCurrentTerm: boolean;
  /** Existing enrollment share token for this term, or null when not shared. */
  shareToken: string | null;
};

const VISIBLE_SECTIONS = 3;
// Stable identity: a fresh Set every render would re-run the overlay's memos.
const EMPTY_SECTION_IDS: Set<string> = new Set();
type Tab = 'upcoming' | 'past' | 'calendar';

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`shrink-0 whitespace-nowrap border-b-2 pb-2 text-sm font-medium ${
        active
          ? 'border-brand-accent text-brand-accent'
          : 'border-transparent text-text-secondary hover:border-border hover:text-foreground'
      }`}
    >
      {children}
    </button>
  );
}

function SectionList({ sections }: { sections: SectionLite[] }) {
  const [expanded, setExpanded] = useState(false);
  if (sections.length === 0) {
    return <span className="text-sm text-text-tertiary">No sections added</span>;
  }
  const hidden = sections.length - VISIBLE_SECTIONS;
  const shown = expanded ? sections : sections.slice(0, VISIBLE_SECTIONS);

  return (
    <div className="space-y-1">
      {shown.map((s) => (
        <Link key={s.id} href={s.href} className="block truncate text-sm text-brand-accent hover:underline">
          {s.label}
        </Link>
      ))}
      {/* A plain button rather than <details>/<summary>: a summary always
          renders above its own content, so "See less" could never sit at the
          bottom of the list it collapses. */}
      {hidden > 0 && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="text-xs text-text-tertiary transition-colors hover:text-foreground"
        >
          {expanded ? 'See less' : `More (${hidden})`}
        </button>
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
        {/*
          A phone is too narrow for three columns. At a third of ~340px the
          name column ran "2026-27 Winter Term 2 (UBC-V)" down four lines while
          the sections beside it were squeezed to ellipses — every cell losing
          at once. Below sm: the table stops being a table and each row becomes
          a card: name across the top, sections full width beneath it, actions
          pinned to the corner. The headers go with it, since a stacked row has
          nothing to head.
        */}
        <table className="w-full table-fixed text-left max-sm:block">
          <thead className="max-sm:hidden">
            <tr className="border-b border-border text-xs text-text-tertiary">
              <th className="w-1/3 px-4 py-2 font-medium">Saved Schedule</th>
              <th className="px-4 py-2 font-medium">Course Sections</th>
              {/* Sized for the actions button plus a gutter. The table is
                  fixed-layout, so a column narrower than its contents does
                  not grow to fit them, it lets them overflow. */}
              <th className="w-16 px-2 py-2" />
            </tr>
          </thead>
          <tbody className="max-sm:block">
            {group.rows.map((s) => (
              <tr
                key={s.id}
                className="border-b border-border last:border-b-0 max-sm:relative max-sm:block max-sm:px-4 max-sm:py-3"
              >
                <td className="px-4 py-3 align-top max-sm:block max-sm:px-0 max-sm:py-0 max-sm:pr-12">
                  <Link href={`/schedule/${s.id}`} className="font-medium text-brand-accent hover:underline">
                    {s.name}
                  </Link>
                </td>
                <td className="px-4 py-3 align-top max-sm:block max-sm:px-0 max-sm:pb-0 max-sm:pt-2">
                  <SectionList sections={s.sections} />
                </td>
                <td className="px-2 py-3 text-right align-middle max-sm:absolute max-sm:right-2 max-sm:top-2 max-sm:px-0 max-sm:py-0">
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

// The calendar is drawn from Workday enrollment data, so every fix for it —
// nothing imported yet, or a schedule that changed since the last import —
// is the same upload form on the Account page.
function UploadLink({ children, primary }: { children: string; primary?: boolean }) {
  return (
    <Link
      href="/onboarding#upload"
      className={
        primary
          ? 'mt-3 inline-block rounded-pill bg-brand px-4 py-2 text-sm font-medium text-brand-foreground transition duration-150 ease-out hover:scale-[1.02] hover:bg-brand-hover active:scale-100'
          : 'text-xs font-medium text-brand-accent hover:underline'
      }
    >
      {children}
    </Link>
  );
}

function CalendarTerm({
  group,
  first,
  onSelectCourse,
}: {
  group: CalendarTermGroup;
  first: boolean;
  onSelectCourse: (courseId: string) => void;
}) {
  return (
    <div className={first ? '' : 'mt-8'}>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <div className="flex w-full items-center gap-2 sm:w-auto sm:gap-3">
          {/* The term name gets the full width on a phone: squeezed between two
              buttons it wrapped to five lines. min-w-0 lets it shrink rather
              than force the row wider than the screen. */}
          <h3 className="min-w-0 flex-1 text-sm font-medium text-foreground sm:flex-none">
            {group.termName}
          </h3>
          {group.entries.length > 0 && (
            <>
              <ShareLinkMenu
                align="left"
                initialToken={group.shareToken}
                pathFor={(t) => `/shared/enrolled/${t}`}
                enable={() => enableEnrollmentSharing(group.termId)}
                disable={() => disableEnrollmentSharing(group.termId)}
                description="Creates a link that shows this term's calendar to anyone who opens it, without signing in. It doesn't show your name or email."
              />
              <CalendarSubscribeMenu
                align="left"
                getUrl={async () => {
                  const result = await getEnrolledSubscribeUrl(group.termId);
                  return result.ok
                    ? `${window.location.origin}/api/calendar/enrolled/${result.token}`
                    : null;
                }}
              />
            </>
          )}
        </div>
        {group.entries.length > 0 && <UploadLink>Update courses →</UploadLink>}
      </div>
      {group.entries.length === 0 ? (
        <div className="mt-2">
          <p className="text-sm text-text-tertiary">
            No enrolled courses on record for this term.
          </p>
          <UploadLink primary>Upload your Workday export →</UploadLink>
        </div>
      ) : (
        <div className="mt-2">
          <ScheduleCalendar
            entries={group.entries}
            showNowIndicator={group.isCurrentTerm}
            onSelectCourse={onSelectCourse}
          />
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
  // Which calendar block was clicked. The term travels with it: course detail
  // is fetched per term, and this tab stacks one calendar per term.
  const [info, setInfo] = useState<{ courseId: string; termId: string } | null>(null);
  const groups = tab === 'upcoming' ? upcoming : past;

  return (
    <div className="mt-8">
      {/* overflow-x-auto: three long labels in a phone column otherwise wrap
          into a ragged 3-line block — same treatment as explore's sort chips. */}
      <div className="flex gap-6 overflow-x-auto border-b border-border">
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
          calendar.map((g, i) => (
            <CalendarTerm
              key={g.termId}
              group={g}
              first={i === 0}
              onSelectCourse={(courseId) => setInfo({ courseId, termId: g.termId })}
            />
          ))
        ) : (
          <>
            {program && <p className="mb-2 font-semibold text-foreground">{program}</p>}
            {groups.length === 0 ? (
              <p className="text-text-secondary">
                {tab === 'upcoming'
                  ? 'No upcoming saved schedules yet. Create one above.'
                  : 'No past saved schedules.'}
              </p>
            ) : (
              groups.map((g, i) => <TermTable key={g.termId} group={g} first={i === 0} />)
            )}
          </>
        )}
      </div>

      {/* Read-only here: no builder to add or swap sections into, so the
          overlay shows the course and its sections and nothing more. */}
      <CourseInfoOverlay
        courseId={info?.courseId ?? null}
        termId={info?.termId ?? ''}
        addedSectionIds={EMPTY_SECTION_IDS}
        onClose={() => setInfo(null)}
      />
    </div>
  );
}
