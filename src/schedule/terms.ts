/**
 * Only the current calendar year's terms are plannable (e.g. in 2026: Summer
 * 2026, Winter 2026-27 Term 1, Winter 2026-27 Term 2) — no building a
 * schedule for a term that's already over.
 */
export function isPlannableTerm(term: { year: number }): boolean {
  return term.year >= new Date().getFullYear();
}
