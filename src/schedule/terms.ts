type TermLike = { year: number; session: string; termNumber: number | null };

/**
 * A term's position in academic-year order: Summer < Winter T1 < Winter T2,
 * all within the same `year` (UBC's `year` field is the academic year the
 * term STARTS in — "2026-27 Winter Term 2" runs Jan-Apr 2027 but is stored
 * as year 2026, termNumber 2 — so ordinal = year*10 + phase sorts correctly).
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

/** Term hasn't started (by the same coarse month-based "now" as currentOrdinal) — used to split saved schedules into Upcoming vs Past tabs, and by CourseScheduleBox to show only current/upcoming terms. */
export function isUpcomingTerm<T extends TermLike>(term: T): boolean {
  return ordinal(term) >= currentOrdinal();
}

/**
 * A term is plannable once it hasn't finished yet — the term currently
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
 * than by `year` alone — which interleaves the two Winter terms wrongly.
 */
export function compareTerms(a: TermLike, b: TermLike): number {
  return ordinal(a) - ordinal(b);
}

/**
 * "This term" and "next term" — the two terms chronologically nearest to
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
