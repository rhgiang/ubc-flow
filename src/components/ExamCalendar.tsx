import type { ExamListItem } from '@/schedule/exams';
import { examCalendar, type ExamDayCell } from '@/schedule/exam-calendar';
import ExamList from '@/components/ExamList';

/** Sunday-first, matching the grid `examCalendar` builds. */
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * One exam in a day square. There is no room here for rooms and surname
 * splits — that is what the list view is for — so a chip carries the course,
 * the time, and whether it came from UBC or a syllabus, and nothing else.
 * A dashed border is the syllabus marker; `title` spells it out on hover for
 * anyone who doesn't read the legend.
 */
function ExamChip({ group }: { group: ExamListItem[] }) {
  const item = group[0];
  const fromSyllabus = item.source === 'syllabus';
  return (
    <div
      title={
        fromSyllabus
          ? `${item.courseLabel} — from your syllabus, double-check this date`
          : `${item.courseLabel} — UBC exam schedule`
      }
      className={`truncate rounded-input border px-1 py-0.5 text-xs ${
        fromSyllabus
          ? 'border-dashed border-border bg-surface-muted text-text-secondary'
          : 'border-brand-accent bg-surface text-brand-accent'
      }`}
    >
      <span className="font-medium">{item.courseLabel}</span>
      {item.startTime && <span className="hidden sm:inline"> · {item.startTime}</span>}
    </div>
  );
}

function DayCell({ cell }: { cell: ExamDayCell }) {
  if (cell.day === null) {
    return <div className="min-h-16 bg-surface-muted" />;
  }
  return (
    // min-h-16 keeps an empty week from collapsing into a hairline — the
    // whole point of this view is seeing that three exams land in two days,
    // which only reads against evenly sized squares.
    <div className="min-h-16 space-y-0.5 p-1">
      <div className="text-xs text-text-tertiary">{cell.day}</div>
      {cell.groups.map((g) => (
        <ExamChip key={g[0].id} group={g} />
      ))}
    </div>
  );
}

/**
 * A month grid per month the student actually has exams in, plus whatever
 * couldn't be placed on a grid at all. Cancelled and dateless exams have no
 * day to sit on, so they are re-rendered through `ExamList` below the grid —
 * same cards, same strikethrough, same "Date TBA" as the list view, for free.
 */
export default function ExamCalendar({ items }: { items: ExamListItem[] }) {
  const { months, unscheduled } = examCalendar(items);

  if (months.length === 0 && unscheduled.length === 0) {
    return (
      <p className="text-sm text-text-secondary">
        Nothing to put on a calendar yet. UBC publishes the final exam schedule partway
        through term, and midterms show up once you upload a syllabus.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      {months.map((month) => (
        <div key={month.key}>
          <h3 className="text-sm font-medium text-foreground">{month.label}</h3>
          <div className="mt-2 overflow-hidden rounded-card border border-border">
            <div className="grid grid-cols-7 border-b border-border bg-surface-muted text-center text-xs text-text-tertiary">
              {WEEKDAYS.map((d) => (
                <div key={d} className="py-1">
                  {/* A phone gives each column ~48px; "S M T W T F S" is what
                      fits, and the row above the numbers needs no more. */}
                  <span className="sm:hidden">{d[0]}</span>
                  <span className="hidden sm:inline">{d}</span>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-px bg-border">
              {month.cells.map((cell, i) => (
                <div key={i} className="bg-surface">
                  <DayCell cell={cell} />
                </div>
              ))}
            </div>
          </div>
        </div>
      ))}

      {months.length > 0 && (
        <p className="text-xs text-text-tertiary">
          Dashed outline = from your syllabus, not UBC&apos;s published schedule.
        </p>
      )}

      {unscheduled.length > 0 && (
        <div>
          <h3 className="text-sm font-medium text-foreground">Not on the calendar</h3>
          <p className="mb-2 text-xs text-text-tertiary">
            These have no date to sit on — a cancelled exam, or one UBC hasn&apos;t
            scheduled yet.
          </p>
          <ExamList items={unscheduled.flat()} />
        </div>
      )}
    </div>
  );
}
