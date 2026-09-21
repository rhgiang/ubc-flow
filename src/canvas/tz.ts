// src/canvas/tz.ts
export const VANCOUVER = 'America/Vancouver';

/**
 * Minutes to ADD to a UTC instant to get the wall clock in `timeZone`. Node
 * has no Temporal yet, so this reads the zone's clock back through Intl and
 * measures the gap: the one dependency-free way to handle DST correctly.
 */
function offsetMinutes(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at);
  const get = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  const wall = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return Math.round((wall - at.getTime()) / 60000);
}

/** A wall-clock time in `timeZone` as the UTC instant it names. Two passes,
 *  because the first guess can land on the other side of a DST change. */
export function zonedToUtc(
  y: number, mo: number, d: number, h: number, mi: number, s: number, timeZone: string,
): Date {
  const guess = new Date(Date.UTC(y, mo - 1, d, h, mi, s));
  const first = new Date(guess.getTime() - offsetMinutes(guess, timeZone) * 60000);
  const again = offsetMinutes(first, timeZone);
  return new Date(guess.getTime() - again * 60000);
}

/** 23:59:59 in Vancouver on a calendar date, as a UTC instant. Accepts
 *  "20261026" (as Canvas writes VALUE=DATE) or "2026-10-26". */
export function vancouverEndOfDayUtc(ymd: string): Date {
  const m = ymd.replace(/-/g, '').match(/^(\d{4})(\d{2})(\d{2})$/);
  if (!m) throw new Error(`Not a calendar date: ${ymd}`);
  return zonedToUtc(Number(m[1]), Number(m[2]), Number(m[3]), 23, 59, 59, VANCOUVER);
}

/** For emails and the page. An all-day item shows the date only: its 11:59
 *  p.m. is our convention, not the syllabus's, and printing it would read as
 *  a time the prof set. */
export function formatVancouver(at: Date, allDay: boolean): string {
  const base: Intl.DateTimeFormatOptions = { timeZone: VANCOUVER, weekday: 'short', month: 'short', day: 'numeric' };
  if (allDay) return at.toLocaleDateString('en-CA', base);
  return at.toLocaleString('en-CA', { ...base, hour: 'numeric', minute: '2-digit' });
}

/**
 * "2026-09-20", the Vancouver calendar day an instant falls on. Computed on
 * the server and shipped as a string so the month grid can be built from
 * plain numbers, with no Date or Intl in the browser. See the note on toRow
 * in src/app/deadlines/page.tsx for why any date arithmetic in a client
 * component is a hydration mismatch waiting to happen.
 */
export function vancouverDayKey(at: Date): string {
  // en-CA formats as YYYY-MM-DD, which is also the sort order we want.
  return at.toLocaleDateString('en-CA', { timeZone: VANCOUVER, year: 'numeric', month: '2-digit', day: '2-digit' });
}
