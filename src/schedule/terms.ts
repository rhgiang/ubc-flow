type TermLike = { year: number; session: string; termNumber: number | null };

/**
 * A term's position in academic-year order: Summer < Winter T1 < Winter T2,
 * all within the same `year` (UBC's `year` field is the academic year the
 * term STARTS in - "2026-27 Winter Term 2" runs Jan-Apr 2027 but is stored
 * as year 2026, termNumber 2 - so ordinal = year*10 + phase sorts correctly).
 */
function ordinal(t: TermLike): number {
  const phase = t.session === 'S' ? 0 : t.termNumber === 1 ? 1 : 2;
  return t.year * 10 + phase;
}

/**
 * Terms have no populated startDate/endDate in this dataset, so "now" is
 * mapped onto the same phase scale using UBC-V's well-known session months:
 * Jan-Apr = Winter T2 (of the academic year that started the previous Sept),
 * May-Aug = Summer, Sep-Dec = Winter T1.
 */
function currentOrdinal(): number {
  const now = new Date();
  const month = now.getMonth() + 1;
  if (month <= 4) return (now.getFullYear() - 1) * 10 + 2;
  if (month <= 8) return now.getFullYear() * 10 + 0;
  return now.getFullYear() * 10 + 1;
}

/** Term hasn't started (by the same coarse month-based "now" as currentOrdinal) - used to split saved schedules into Upcoming vs Past tabs, and by CourseScheduleBox to show only current/upcoming terms. */
export function isUpcomingTerm<T extends TermLike>(term: T): boolean {
  return ordinal(term) >= currentOrdinal();
}

/**
 * A term is plannable once it hasn't finished yet - the term currently
 * running and every term after it. `Term.year` is the academic year a term
 * STARTS in ("2026-27 Winter Term 2" runs Jan-Apr 2027 but is stored as
 * year: 2026), so a plain `year >= currentYear` check breaks from January
 * onward, wrongly excluding the term the student is literally sitting in.
 * Same ordinal comparison as isUpcomingTerm, which this delegates to.
 */
export function isPlannableTerm<T extends TermLike>(term: T): boolean {
  return isUpcomingTerm(term);
}

/**
 * Chronological order, Summer before Winter T1 before Winter T2. Exported so
 * callers listing several terms sort them the same way the pickers do, rather
 * than by `year` alone - which interleaves the two Winter terms wrongly.
 */
export function compareTerms(a: TermLike, b: TermLike): number {
  return ordinal(a) - ordinal(b);
}

/**
 * "This term" and "next term" - the two terms chronologically nearest to
 * today. A tighter pick than isPlannableTerm above, which permissively
 * includes every term from now onward.
 */
export function getCurrentAndNextTerm<T extends TermLike>(
  terms: T[],
): { current: T | null; next: T | null } {
  const sorted = [...terms].sort((a, b) => ordinal(a) - ordinal(b));
  const now = currentOrdinal();
  const currentIndex = sorted.findIndex((t) => ordinal(t) >= now);
  if (currentIndex === -1) return { current: null, next: null };
  return { current: sorted[currentIndex], next: sorted[currentIndex + 1] ?? null };
}

/** The calendar window a term's dates fall in, as YYYY-MM-DD. Compared as
 *  strings on purpose: these are plain calendar days with no time zone in
 *  them, and that is also the shape the extraction reports dates in. */
export type TermWindow = { start: string; end: string };

function isoDay(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** UBC-V's session months, the same mapping `currentOrdinal` reads in the
 *  other direction. Each window runs to the end of its last month so a final
 *  sat in the registrar's exam period (late December, late April) is inside
 *  the term rather than looking like a year adrift. */
function sessionWindow(t: TermLike): TermWindow {
  if (t.session === 'S') return { start: isoDay(t.year, 5, 1), end: isoDay(t.year, 8, 31) };
  if (t.termNumber === 1) return { start: isoDay(t.year, 9, 1), end: isoDay(t.year, 12, 31) };
  if (t.termNumber === 2) return { start: isoDay(t.year + 1, 1, 1), end: isoDay(t.year + 1, 4, 30) };
  // Neither a session nor a term number we recognise. The whole academic year
  // is still enough to pin a year onto a stated month.
  return { start: isoDay(t.year, 1, 1), end: isoDay(t.year + 1, 4, 30) };
}

/**
 * When a term runs, for anything that has to resolve "Oct 26" to a real year.
 *
 * `Term.startDate`/`endDate` are the schema's answer to this, and in this
 * dataset they are NULL on every row: the catalogue scrape
 * (src/scrape/parse-catalog.ts) reads the term picker, which publishes a name
 * and nothing else. So the session months are the floor, by the same UBC-V
 * mapping `currentOrdinal` above already relies on, and the columns only ever
 * widen that window when they are populated and reach outside it.
 */
export function termDateRange(
  term: TermLike & { startDate?: Date | null; endDate?: Date | null },
): TermWindow {
  const { start, end } = sessionWindow(term);
  const from = term.startDate ? isoDate(term.startDate) : null;
  const to = term.endDate ? isoDate(term.endDate) : null;
  return {
    start: from && from < start ? from : start,
    end: to && to > end ? to : end,
  };
}
