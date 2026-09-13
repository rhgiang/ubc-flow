'use client';

import { useEffect, useState } from 'react';
import type { ExamListItem } from '@/schedule/exams';
import { examCalendar, type ExamDayCell, type ExamMonth } from '@/schedule/exam-calendar';
import { courseColorIndex } from '@/schedule/colors';
import ExamList, { formatDate, type SelectExam } from '@/components/ExamList';

/** Sunday-first, matching the grid `examCalendar` builds. */
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Which square is today, resolved after mount - the server's zone need not be
 *  the viewer's, so deriving it during render would hydrate-mismatch. Same
 *  reason ScheduleCalendar resolves its now-indicator in an effect. */
type Today = { key: string; day: number };

/**
 * One exam in a day square, painted in the course's own colour - the same slot
 * ScheduleCalendar gives that course in the weekly grid, so BIOL 121 is the
 * same colour wherever a student meets it.
 *
 * There is no room here for rooms and surname splits; that is what the overlay
 * is for, and the whole chip is the button that opens it.
 */
function ExamChip({ group, onSelect }: { group: ExamListItem[]; onSelect: SelectExam }) {
  const item = group[0];
  const slot = courseColorIndex(item.courseLabel);
  const fromSyllabus = item.source === 'syllabus';

  return (
    <button
      type="button"
      onClick={() => onSelect(group)}
      // The date is in the aria-label because the day number that carries it
      // is in a different element - a screen reader reaching this button
      // linearly would otherwise hear a course code and a time with no day.
      aria-label={`${item.courseLabel}${item.date ? `, ${formatDate(item.date)}` : ''}${
        item.startTime ? ` at ${item.startTime}` : ''
      }${fromSyllabus ? ', from your syllabus' : ''}`}
      title={
        fromSyllabus
          ? `${item.courseLabel} - from your syllabus, double-check this date`
          : `${item.courseLabel} - UBC exam schedule`
      }
      style={{
        background: `var(--course-${slot}-bg)`,
        boxShadow: `inset 3px 0 0 0 var(--course-${slot}-accent)`,
        // A dashed outline is the syllabus marker. Drawn as an inset outline
        // rather than a border so it costs the chip no width - the squares are
        // ~48px on a phone and a course code needs all of them.
        outline: fromSyllabus ? `1px dashed var(--course-${slot}-accent)` : undefined,
        outlineOffset: '-1px',
      }}
      className="block w-full overflow-hidden rounded-md py-0.5 pl-1.5 pr-1 text-left leading-[1.15] transition-opacity hover:opacity-80 sm:pl-2"
    >
      <span className="block truncate text-[0.5625rem] font-medium text-foreground sm:text-[0.6875rem]">
        {item.courseLabel}
      </span>
      {item.startTime && (
        <span className="hidden truncate text-[0.625rem] text-text-secondary sm:block">
          {item.startTime}
        </span>
      )}
    </button>
  );
}

function DayCell({
  cell,
  isToday,
  onSelect,
}: {
  cell: ExamDayCell;
  isToday: boolean;
  onSelect: SelectExam;
}) {
  if (cell.day === null) {
    return <div className="min-h-[3.5rem] bg-surface-muted sm:min-h-[5rem]" />;
  }
  return (
    // A fixed minimum keeps an empty week from collapsing into a hairline -
    // the whole point of this view is seeing that three exams land in two days,
    // which only reads against evenly sized squares.
    <div className="min-h-[3.5rem] space-y-0.5 bg-surface p-1 sm:min-h-[5rem] sm:p-1.5">
      <div
        className={`px-0.5 text-[0.625rem] sm:text-[0.6875rem] ${
          isToday ? 'font-semibold text-brand-accent' : 'text-text-tertiary'
        }`}
      >
        {cell.day}
      </div>
      {cell.groups.map((g) => (
        <ExamChip key={g[0].id} group={g} onSelect={onSelect} />
      ))}
    </div>
  );
}

function MonthGrid({
  month,
  today,
  onSelect,
}: {
  month: ExamMonth;
  today: Today | null;
  onSelect: SelectExam;
}) {
  const count = month.cells.reduce((n, c) => n + c.groups.length, 0);

  return (
    // Same shell as every other surface on the page: rounded-card over a
    // hairline border, a header strip on the background tone, hairline gaps
    // between the squares.
    <div className="overflow-hidden rounded-card border border-border">
      <div className="flex h-9 items-center justify-between border-b border-border bg-background px-3">
        <h3 className="text-sm font-medium text-foreground">{month.label}</h3>
        <span className="text-xs text-text-tertiary">
          {count} exam{count === 1 ? '' : 's'}
        </span>
      </div>
      <div className="grid grid-cols-7 border-b border-border-hairline bg-background text-center text-xs font-medium text-text-secondary">
        {WEEKDAYS.map((d) => (
          <div key={d} className="py-1.5">
            {/* A phone gives each column ~48px; "S M T W T F S" is what fits,
                and the row above the numbers needs no more. */}
            <span className="sm:hidden">{d[0]}</span>
            <span className="hidden sm:inline">{d}</span>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-px bg-border-hairline">
        {month.cells.map((cell, i) => (
          <DayCell
            key={i}
            cell={cell}
            isToday={today !== null && today.key === month.key && today.day === cell.day}
            onSelect={onSelect}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * A month grid per month the student actually has exams in, plus whatever
 * couldn't be placed on a grid at all. Cancelled and dateless exams have no
 * day to sit on, so they are re-rendered through `ExamList` below the grid -
 * same cards, same strikethrough, same "Date TBA" as the list view, for free.
 */
export default function ExamCalendar({
  items,
  onSelect,
}: {
  items: ExamListItem[];
  onSelect: SelectExam;
}) {
  const { months, unscheduled } = examCalendar(items);
  const [today, setToday] = useState<Today | null>(null);
  useEffect(() => {
    const now = new Date();
    setToday({
      key: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`,
      day: now.getDate(),
    });
  }, []);

  if (months.length === 0 && unscheduled.length === 0) {
    return (
      <p className="text-sm text-text-secondary">
        Nothing to put on a calendar yet. Midterms show up once you upload a syllabus.
      </p>
    );
  }

  const hasSyllabusExam = months.some((m) =>
    m.cells.some((c) => c.groups.some((g) => g[0].source === 'syllabus')),
  );

  return (
    <div className="space-y-6">
      {months.map((month) => (
        <MonthGrid key={month.key} month={month} today={today} onSelect={onSelect} />
      ))}

      {hasSyllabusExam && (
        <p className="text-xs text-text-tertiary">
          Dashed outline = from your syllabus, not UBC&apos;s published schedule.
        </p>
      )}

      {unscheduled.length > 0 && (
        <div>
          <h3 className="text-sm font-medium text-foreground">Not on the calendar</h3>
          <p className="mb-2 text-xs text-text-tertiary">
            These have no date to sit on - a cancelled exam, or one UBC hasn&apos;t
            scheduled yet.
          </p>
          <ExamList items={unscheduled.flat()} onSelect={onSelect} />
        </div>
      )}
    </div>
  );
}
