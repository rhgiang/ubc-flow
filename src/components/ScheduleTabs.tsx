'use client';

import { useState } from 'react';
import Link from 'next/link';
import ScheduleRowActions from '@/components/ScheduleRowActions';
import ScheduleCalendar, { type CalendarEntry } from '@/components/schedule/ScheduleCalendar';
import CourseInfoOverlay from '@/components/schedule/CourseInfoOverlay';
import CalendarSubscribeMenu from '@/components/schedule/CalendarSubscribeMenu';
import ShareLinkMenu from '@/components/schedule/ShareLinkMenu';
import CampusMap from '@/components/CampusMap';
import ExamList, { ExamCoverageNote } from '@/components/ExamList';
import ExamCalendar from '@/components/ExamCalendar';
import ExamDetailOverlay from '@/components/ExamDetailOverlay';
import SyllabusList, { type SyllabusListItem } from '@/components/SyllabusList';
import type { ExamCoverage, ExamListItem } from '@/schedule/exams';
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

/**
 * Everything the Exams tab needs, or null for a signed-out visitor - an exam
 * list is per-student, and this page lets signed-out people look around the
 * rest of it.
 *
 * Exams live here rather than at /exams because they answer the same question
 * a timetable does: when and where am I supposed to be. The syllabus rows come
 * along for the same reason - uploading a syllabus is not a destination, it is
 * how midterms get onto this view, so it hangs off the gap in the exam list
 * instead of owning a tab or a nav pill.
 */
export type ExamsTabData = {
  items: ExamListItem[];
  /** Null when we can't work out the current term; the syllabus form needs it. */
  termId: string | null;
  /** Whether UBC has published this term's schedule, and which enrolled
   *  courses are missing from it once it is out. */
  coverage: ExamCoverage;
  syllabi: SyllabusListItem[];
  /** Existing share token for this term - the same one the Calendar tab uses,
   *  since it is the same term's schedule either tab shares. */
  shareToken: string | null;
};

const VISIBLE_SECTIONS = 3;
// Stable identity: a fresh Set every render would re-run the overlay's memos.
const EMPTY_SECTION_IDS: Set<string> = new Set();
type Tab = 'upcoming' | 'past' | 'calendar' | 'map' | 'exams';

/**
 * `short` is what a phone gets. The full set of labels needs 568px of strip in
 * a 334px viewport, which put View Calendar 46px past the right edge of the
 * screen and Map further still - reachable only by discovering that a hairline
 * strip scrolls sideways, which nobody does. "Saved Schedules" is also the
 * heading directly above, so the phone loses only a word it already read.
 */
function TabButton({
  active,
  onClick,
  short,
  children,
}: {
  active: boolean;
  onClick: () => void;
  short?: string;
  children: string;
}) {
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
      {short ? (
        <>
          <span className="sm:hidden">{short}</span>
          <span className="hidden sm:inline">{children}</span>
        </>
      ) : (
        children
      )}
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
          the sections beside it were squeezed to ellipses - every cell losing
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

// The calendar is drawn from Workday enrollment data, so every fix for it -
// nothing imported yet, or a schedule that changed since the last import -
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
  onSelectCourse: (courseId: string, label?: string) => void;
}) {
  return (
    // mt-5 on a phone: the term heading, its two buttons and the update link
    // already stack into three rows before the grid starts, so a full mt-8 on
    // top of that was most of a screen of chrome between one term and the next.
    <div className={first ? '' : 'mt-5 sm:mt-8'}>
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
                description="Creates a link that shows this term's calendar and UBC's published finals to anyone who opens it, without signing in. It doesn't show your name or email."
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

function ExamsTab({ exams }: { exams: ExamsTabData | null }) {
  // List and calendar are the same data, so this is a view switch inside the
  // tab rather than a sixth tab in the strip above. TabButton is reused so it
  // reads as the same control, one level down.
  const [view, setView] = useState<'list' | 'calendar'>('list');
  // The clicked exam, as the grouped rows both views hand over - one exam
  // split across rooms by surname is one selection, same as it is one card.
  const [selected, setSelected] = useState<ExamListItem[] | null>(null);

  if (!exams) {
    return (
      <p className="text-sm text-text-secondary">
        Sign in to see your exam schedule for this term.
      </p>
    );
  }

  // Narrowed once into a const so the callbacks below close over a string
  // rather than a possibly-null property.
  const termId = exams.termId;

  return (
    <div>
      <div className="flex items-end justify-between gap-3 border-b border-border">
        <div className="flex gap-5 sm:gap-6">
          <TabButton active={view === 'list'} onClick={() => setView('list')}>
            List
          </TabButton>
          <TabButton active={view === 'calendar'} onClick={() => setView('calendar')}>
            Calendar
          </TabButton>
        </div>
        {/* The same two controls the Calendar tab carries, on the same term's
            data: exams are already in that ICS feed, and the shared page shows
            them. Syllabus midterms and the uploaded PDFs are not in either -
            they stay on this page, behind the student's own session. */}
        {termId && (
          <div className="flex items-center gap-2 pb-2">
            <ShareLinkMenu
              initialToken={exams.shareToken}
              pathFor={(t) => `/shared/enrolled/${t}`}
              enable={() => enableEnrollmentSharing(termId)}
              disable={() => disableEnrollmentSharing(termId)}
              description="Creates a link that shows this term's calendar and UBC's published finals to anyone who opens it. Your syllabus uploads, and the midterms read out of them, are never shared."
            />
            <CalendarSubscribeMenu
              getUrl={async () => {
                const result = await getEnrolledSubscribeUrl(termId);
                return result.ok
                  ? `${window.location.origin}/api/calendar/enrolled/${result.token}`
                  : null;
              }}
            />
          </div>
        )}
      </div>

      <div className="mt-4">
        {view === 'list' ? (
          <ExamList items={exams.items} onSelect={setSelected} />
        ) : (
          <ExamCalendar items={exams.items} onSelect={setSelected} />
        )}
      </div>

      {/* Under the exams rather than over them: it is the footnote to the list
          - what ISN'T on it and why - not the headline. */}
      <ExamCoverageNote coverage={exams.coverage} />

      <ExamDetailOverlay group={selected} onClose={() => setSelected(null)} />

      {/* Closed by default and phrased as the answer to "where are my
          midterms?" - a syllabus upload is the means, not a place to go. */}
      <details className="mt-6 rounded-card border border-border bg-surface p-4">
        <summary className="cursor-pointer text-sm font-medium text-foreground">
          Midterms missing? They come from your syllabus.
        </summary>
        <p className="mt-2 text-sm text-text-secondary">
          UBC only publishes finals. Upload a course syllabus and we&apos;ll read the
          midterm dates out of it - you confirm them before anything lands above. Your
          files stay private to you.
        </p>
        {!exams.termId ? (
          <p className="mt-3 text-sm text-text-secondary">
            We couldn&apos;t work out the current term.
          </p>
        ) : exams.syllabi.length === 0 ? (
          <p className="mt-3 text-sm text-text-secondary">
            No courses on record for this term yet. Upload your Workday export from the{' '}
            <Link href="/onboarding#upload" className="font-medium text-brand-accent hover:underline">
              Account page
            </Link>{' '}
            first.
          </p>
        ) : (
          <div className="mt-3">
            <SyllabusList termId={exams.termId} items={exams.syllabi} />
          </div>
        )}
      </details>
    </div>
  );
}

export default function ScheduleTabs({
  program,
  upcoming,
  past,
  calendar,
  exams,
  initialTab = 'upcoming',
}: {
  program: string | null;
  upcoming: TermGroup[];
  past: TermGroup[];
  calendar: CalendarTermGroup[];
  exams: ExamsTabData | null;
  /** Set from ?tab= so the old /exams and /syllabus links land on this tab. */
  initialTab?: Tab;
}) {
  const [tab, setTab] = useState<Tab>(initialTab);
  // Which calendar block was clicked. The term travels with it: course detail
  // is fetched per term, and this tab stacks one calendar per term. The
  // section code rides along so the overlay can flag the student's own
  // section instead of presenting all forty as equals.
  const [info, setInfo] = useState<{
    courseId: string;
    termId: string;
    sectionCode: string | null;
  } | null>(null);
  const groups = tab === 'upcoming' ? upcoming : past;

  return (
    <div className="mt-8">
      {/* overflow-x-auto is the fallback for a narrow phone in a large font,
          not the plan: the short labels below are what make all four tabs
          reachable without sideways scrolling. */}
      <div className="flex gap-5 overflow-x-auto border-b border-border sm:gap-6">
        <TabButton active={tab === 'upcoming'} onClick={() => setTab('upcoming')} short="Upcoming">
          Upcoming Saved Schedules
        </TabButton>
        <TabButton active={tab === 'past'} onClick={() => setTab('past')} short="Past">
          Past Saved Schedules
        </TabButton>
        <TabButton active={tab === 'calendar'} onClick={() => setTab('calendar')} short="Calendar">
          View Calendar
        </TabButton>
        {/* One word already, like Map - nothing to shorten for a phone. */}
        <TabButton active={tab === 'exams'} onClick={() => setTab('exams')}>
          Exams
        </TabButton>
        <TabButton active={tab === 'map'} onClick={() => setTab('map')}>
          Map
        </TabButton>
      </div>

      <div className="mt-6">
        {tab === 'exams' ? (
          <ExamsTab exams={exams} />
        ) : tab === 'map' ? (
          // Same enrollment groups the calendar tab draws - the map is the
          // "where" view of the identical data.
          calendar.every((g) => g.entries.length === 0) ? (
            <div>
              <p className="text-sm text-text-tertiary">
                No enrolled courses on record to map.
              </p>
              <UploadLink primary>Upload your Workday export →</UploadLink>
            </div>
          ) : (
            calendar
              .filter((g) => g.entries.length > 0)
              .map((g, i) => (
                <div key={g.termId} className={i === 0 ? '' : 'mt-8'}>
                  <h3 className="mb-2 text-sm font-medium text-foreground">{g.termName}</h3>
                  <CampusMap entries={g.entries} />
                </div>
              ))
          )
        ) : tab === 'calendar' ? (
          calendar.map((g, i) => (
            <CalendarTerm
              key={g.termId}
              group={g}
              first={i === 0}
              onSelectCourse={(courseId, label) =>
                setInfo({
                  courseId,
                  termId: g.termId,
                  // "MATH 200-103" -> "103". Section codes never contain a
                  // dash, so the last one always splits label from section.
                  sectionCode:
                    label && label.includes('-')
                      ? label.slice(label.lastIndexOf('-') + 1)
                      : null,
                })
              }
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
        highlightSectionCode={info?.sectionCode ?? null}
        onClose={() => setInfo(null)}
      />
    </div>
  );
}
