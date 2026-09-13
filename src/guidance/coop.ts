import type { PlanTerm } from '@/guidance/solver';

/**
 * Co-op, modelled as terms the plan may not use.
 *
 * A work term is not a lighter academic term - it is not an academic term at
 * all. Nothing is scheduled into it, and the coursework that would have gone
 * there moves later, which is exactly why the Calendar says co-op "requires an
 * additional year to complete the Bachelor of Applied Science".
 *
 * That makes this a data change rather than a solver change: `PlanTerm.available`
 * has existed since the solver was written, precisely so a work term could be
 * expressed without touching the placement logic.
 *
 * What co-op does NOT do is add credits. The Faculty of Science is explicit -
 * each work term earns a 3-credit co-op course on the transcript, but "co-operative
 * education course credits cannot be used in lieu of or to complement academic
 * course credits required by the specialization". So the degree total is
 * unchanged and only the calendar stretches.
 */

/** A position in the degree, named the way a student would say it. */
export type WorkSlot = { year: number; slot: 'T1' | 'T2' | 'summer' };

export type CoopPattern = {
  id: string;
  label: string;
  /** Shown beside the plan so the shape is not mistaken for the only one. */
  detail: string;
  work: WorkSlot[];
};

/**
 * The Calendar states co-op's RULES but not its sequence: four work terms
 * minimum for Applied Science, at least one of them in a Winter term, the
 * degree must end on an academic term, and it adds a year. Which terms those
 * are is left to each department's recommended sequence.
 *
 * So these are shaped to satisfy the stated rules rather than transcribed from
 * a page: two four-month blocks each paired with the Winter term after it,
 * which is the common eight-month placement. A student following a specific
 * department sequence should expect their own to differ in placement, never in
 * count.
 */
export const COOP_PATTERNS: CoopPattern[] = [
  {
    id: 'std',
    label: 'Co-op from second year',
    detail:
      'Four work terms: the summer after second year paired with the following Winter ' +
      'Term 1, then the summer after third year paired with the Winter Term 1 after that. ' +
      'Two eight-month placements, which is the usual shape.',
    work: [
      { year: 2, slot: 'summer' },
      { year: 3, slot: 'T1' },
      { year: 3, slot: 'summer' },
      { year: 4, slot: 'T1' },
    ],
  },
  {
    id: 'late',
    label: 'Co-op from third year',
    detail:
      'The same four work terms a year later, for students who apply at the start of ' +
      'third year rather than the end of first. Applied Science allows this for some ' +
      'disciplines.',
    work: [
      { year: 3, slot: 'summer' },
      { year: 4, slot: 'T1' },
      { year: 4, slot: 'summer' },
      { year: 5, slot: 'T1' },
    ],
  },
];

export const getCoopPattern = (id: string | undefined): CoopPattern | null =>
  COOP_PATTERNS.find((p) => p.id === id) ?? null;

/**
 * Which term sits at each position of the degree.
 *
 * Terms arrive in calendar order - Summer, Winter Term 1, Winter Term 2 - so a
 * summer PRECEDES the Winter session it is named beside. "2027 Summer Session"
 * follows 2026-27 Winter Term 2, which makes it the summer after first year,
 * and that is how it is keyed here. The leading summer before any Winter Term 1
 * belongs to no year of the degree and is skipped.
 */
function positions(terms: PlanTerm[]): Map<string, string> {
  const out = new Map<string, string>();
  let year = 0;
  for (const term of terms) {
    if (/winter term 1/i.test(term.name)) {
      year += 1;
      out.set(`${year}:T1`, term.id);
    } else if (year === 0) {
      continue; // a summer before the degree starts
    } else if (/winter term 2/i.test(term.name)) {
      out.set(`${year}:T2`, term.id);
    } else if (/summer/i.test(term.name)) {
      out.set(`${year}:summer`, term.id);
    }
  }
  return out;
}

/**
 * A degree starts in September, not in the summer before it.
 *
 * The term list opens with a Summer Session because that is the next term on
 * the calendar, and with summer enabled the solver happily filled it - first
 * year began with a 15-credit summer nobody registers in, and every year label
 * after it was off. Co-op made this visible by turning summer on for everyone,
 * but the bug was already there for anyone who pressed "Use summer".
 */
export function fromFirstWinter(terms: PlanTerm[]): PlanTerm[] {
  const first = terms.findIndex((t) => /winter term 1/i.test(t.name));
  if (first <= 0) return terms;
  return terms.map((t, i) => (i < first ? { ...t, available: false } : t));
}

/**
 * Which year of the degree each term belongs to.
 *
 * The plan used to label years by counting rows two at a time, which is right
 * only while every term is a Winter one. A summer term - and co-op cannot work
 * without them - shifted every label after it by half a year.
 */
export function degreeYears(terms: PlanTerm[]): Map<string, number> {
  const out = new Map<string, number>();
  let year = 0;
  for (const term of terms) {
    if (/winter term 1/i.test(term.name)) year += 1;
    out.set(term.id, Math.max(1, year));
  }
  return out;
}

/** Term ids the pattern turns into work terms. */
export function workTermIds(terms: PlanTerm[], pattern: CoopPattern | null): Set<string> {
  if (!pattern) return new Set();
  const at = positions(terms);
  const ids = new Set<string>();
  for (const w of pattern.work) {
    const id = at.get(`${w.year}:${w.slot}`);
    if (id) ids.add(id);
  }
  return ids;
}

/**
 * The term list with work terms closed off.
 *
 * Summers are opened up at the same time. Co-op runs year-round by definition -
 * three of the four work terms in a standard sequence are summers - so leaving
 * the student's "use summer" preference to also govern co-op would produce a
 * sequence with nowhere to put the work.
 */
export function applyCoop(terms: PlanTerm[], pattern: CoopPattern | null): PlanTerm[] {
  const work = workTermIds(terms, pattern);
  if (work.size === 0) return terms;
  return terms.map((t) => (work.has(t.id) ? { ...t, available: false } : t));
}
