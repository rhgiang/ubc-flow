/**
 * Only the current calendar year's terms are plannable (e.g. in 2026: Summer
 * 2026, Winter 2026-27 Term 1, Winter 2026-27 Term 2) — no building a
 * schedule for a term that's already over.
 */
export function isPlannableTerm(term: { year: number }): boolean {
  return term.year >= new Date().getFullYear();
}

type TermLike = { id: string; year: number; session: string; termNumber: number | null };

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

/**
 * "This term" and "next term" for the explore-page filter — the two terms
 * chronologically nearest to today, not just "any current-year term" like
 * isPlannableTerm above (that's a coarser, deliberately permissive rule for
 * the schedule planner).
 */
/** Term hasn't started (by the same coarse month-based "now" as currentOrdinal) — used to split saved schedules into Upcoming vs Past tabs. */
export function isUpcomingTerm<T extends TermLike>(term: T): boolean {
  return ordinal(term) >= currentOrdinal();
}

export function getCurrentAndNextTerm<T extends TermLike>(
  terms: T[],
): { current: T | null; next: T | null } {
  const sorted = [...terms].sort((a, b) => ordinal(a) - ordinal(b));
  const now = currentOrdinal();
  const currentIndex = sorted.findIndex((t) => ordinal(t) >= now);
  if (currentIndex === -1) return { current: null, next: null };
  return { current: sorted[currentIndex], next: sorted[currentIndex + 1] ?? null };
}
