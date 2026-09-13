import type { ExamListItem } from '@/schedule/exams';
import { groupExams } from '@/components/ExamList';

/**
 * A month grid of the exam period - the "how bad is this week" view a list
 * can't give you. Deliberately NOT a weekly time-grid: `layoutDayColumns`
 * exists to lay overlapping recurring classes side by side within a day, and
 * exams are one-off, spread over ~2 weeks, and almost never overlap. A month
 * needs no time axis at all; an exam's start time is just a label on its chip.
 *
 * Dates are stored as UTC midnight (src/scrape/jobs/exams.ts), so every read
 * here is a getUTC* one. Using local getters would put an 08:00-UTC-midnight
 * exam on the previous day everywhere west of Greenwich.
 */

/** One square of the grid. `day` is null for the blanks that pad the first and
 *  last weeks out to full rows. */
export type ExamDayCell = { day: number | null; groups: ExamListItem[][] };

export type ExamMonth = {
  /** "2026-12" - stable React key and sort key. */
  key: string;
  /** "December 2026" */
  label: string;
  /** Always a multiple of 7, starting on a Sunday. */
  cells: ExamDayCell[];
};

export type ExamCalendar = {
  months: ExamMonth[];
  /** Groups that cannot occupy a day cell - cancelled exams (their date is
   *  NULL) and syllabus finals with no date yet. Spec guarantees both stay
   *  visible, so they are handed back rather than dropped. */
  unscheduled: ExamListItem[][];
};

const WEEK = 7;

function monthLabel(year: number, month1: number): string {
  return new Date(Date.UTC(year, month1 - 1, 1)).toLocaleDateString('en-CA', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** Later start times sort later; a timeless exam sorts last within its day. */
function byStartTime(a: ExamListItem[], b: ExamListItem[]): number {
  const ta = a[0].startTime ?? '99:99';
  const tb = b[0].startTime ?? '99:99';
  return ta.localeCompare(tb) || a[0].courseLabel.localeCompare(b[0].courseLabel);
}

/**
 * Buckets exams into month grids. Only the months that actually contain an
 * exam are returned - December is not special, a Summer-session student's
 * finals are in August, and `FinalExam.date` is the only thing that decides.
 *
 * Grouping goes through `groupExams`, the same function the list uses, so one
 * exam split across rooms by surname (BIOL 121 in IRC 2 and IRC 6) is one
 * chip in one cell rather than two.
 */
export function examCalendar(items: ExamListItem[]): ExamCalendar {
  const byMonth = new Map<string, Map<number, ExamListItem[][]>>();
  const unscheduled: ExamListItem[][] = [];

  for (const group of groupExams(items)) {
    const { date, cancelled } = group[0];
    if (!date || cancelled) {
      unscheduled.push(group);
      continue;
    }
    const key = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
    const days = byMonth.get(key) ?? new Map<number, ExamListItem[][]>();
    byMonth.set(key, days);
    const day = date.getUTCDate();
    days.set(day, [...(days.get(day) ?? []), group]);
  }

  const months = [...byMonth.keys()].sort().map((key) => {
    const [year, month1] = key.split('-').map(Number);
    const days = byMonth.get(key)!;
    // Day 0 of the next month is the last day of this one.
    const daysInMonth = new Date(Date.UTC(year, month1, 0)).getUTCDate();
    const leading = new Date(Date.UTC(year, month1 - 1, 1)).getUTCDay();

    const cells: ExamDayCell[] = [];
    for (let i = 0; i < leading; i++) cells.push({ day: null, groups: [] });
    for (let d = 1; d <= daysInMonth; d++) {
      cells.push({ day: d, groups: (days.get(d) ?? []).sort(byStartTime) });
    }
    while (cells.length % WEEK !== 0) cells.push({ day: null, groups: [] });

    return { key, label: monthLabel(year, month1), cells };
  });

  return { months, unscheduled };
}
