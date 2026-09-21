// src/canvas/calendar.ts
/**
 * A month grid of deadlines, built from Vancouver day keys rather than Date
 * objects. Everything here is integer and string arithmetic on "2026-09-20",
 * so it is pure, trivially testable, and carries no timezone of its own. The
 * server has already decided which Vancouver day each deadline falls on (see
 * vancouverDayKey); this only arranges those days into weeks.
 *
 * Separate from src/schedule/exam-calendar.ts on purpose. That one groups
 * ExamListItem, merges surname-split rooms, and sorts on an exam start time,
 * none of which a Canvas deadline has. Making it generic would mean reworking
 * a shipped, reviewed feature to gain about thirty lines here.
 */

/** Anything with a Vancouver day key can be laid out. Kept structural so the
 *  grid never needs to know what a deadline is. */
export type Dated = { dayKey: string };

/** One square. `day` is null for the blanks padding the first and last weeks
 *  out to whole rows. */
export type DayCell<T> = { day: number | null; key: string; items: T[] };

export type Month<T> = {
  /** "2026-09", a stable React key and sort key. */
  key: string;
  /** "September 2026" */
  label: string;
  /** Always a multiple of 7, Sunday first. */
  cells: DayCell<T>[];
};

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** Sunday = 0, from a plain date, with no Date parsing or local zone. Sakamoto. */
export function weekdayOf(y: number, m: number, d: number): number {
  const t = [0, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4];
  const yy = m < 3 ? y - 1 : y;
  return (yy + Math.floor(yy / 4) - Math.floor(yy / 100) + Math.floor(yy / 400) + t[m - 1] + d) % 7;
}

/** Days in a month, Gregorian leap rules. */
export function daysInMonth(y: number, m: number): number {
  if (m === 2) return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28;
  return [4, 6, 9, 11].includes(m) ? 30 : 31;
}

/**
 * Buckets items into month grids, one per month that actually holds
 * something. An empty month between two busy ones is skipped rather than
 * rendered blank: a student with nothing in October should not scroll past
 * it to reach November.
 */
export function buildMonths<T extends Dated>(items: T[]): Month<T>[] {
  const byMonth = new Map<string, Map<number, T[]>>();

  for (const it of items) {
    const m = it.dayKey.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) continue; // a malformed key must not take the grid down
    const monthKey = `${m[1]}-${m[2]}`;
    const day = Number(m[3]);
    const days = byMonth.get(monthKey) ?? new Map<number, T[]>();
    days.set(day, [...(days.get(day) ?? []), it]);
    byMonth.set(monthKey, days);
  }

  return [...byMonth.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([monthKey, days]) => {
      const [y, m] = monthKey.split('-').map(Number);
      const lead = weekdayOf(y, m, 1);
      const total = daysInMonth(y, m);
      const cells: DayCell<T>[] = [];

      for (let i = 0; i < lead; i++) cells.push({ day: null, key: `${monthKey}-pad-${i}`, items: [] });
      for (let d = 1; d <= total; d++) {
        cells.push({ day: d, key: `${monthKey}-${String(d).padStart(2, '0')}`, items: days.get(d) ?? [] });
      }
      while (cells.length % 7 !== 0) cells.push({ day: null, key: `${monthKey}-tail-${cells.length}`, items: [] });

      return { key: monthKey, label: `${MONTH_NAMES[m - 1]} ${y}`, cells };
    });
}
