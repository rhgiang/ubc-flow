/**
 * The language degree requirements are written in.
 *
 * Deliberately separate from `Requirement` in src/prereqs/parse.ts. That type
 * describes what a *course* demands and its parser bails on "one of", "N of"
 * and "either" (see its AMBIGUOUS/BAILOUT guards) — which is exactly what a
 * *degree* is made of. The two problems only look alike.
 */

/**
 * Whether a rule was read verbatim from the Calendar or worked out by the
 * curator. Breadth and faculty-wide rules are the ones that get inferred, and
 * they are also the most exception-ridden part of the Calendar, so the UI
 * shows an advisor caveat wherever an inferred rule affects a student. A
 * confidently wrong graduation plan is worse than an incomplete one.
 */
export type Confidence = 'stated' | 'inferred';

/** A set of courses named by enumeration or by pattern. */
export type CourseSet =
  | { kind: 'codes'; codes: string[] }
  | {
      kind: 'pattern';
      /** Subject codes, e.g. ['CPSC', 'AI']. */
      subjects?: string[];
      /** Faculty name, for breadth rules. Requires Subject.faculty (phase 0). */
      faculty?: string;
      /** Course number floor/ceiling, e.g. 300 and 499 for "300 or higher". */
      levelMin?: number;
      levelMax?: number;
      /** Codes to remove from whatever the pattern matched. */
      exclude?: string[];
    };

type Base = {
  id: string;
  label: string;
  sourceUrl?: string;
  confidence?: Confidence;
};

export type Rule =
  /** One named course. */
  | (Base & { kind: 'course'; code: string })
  /** N satisfied from among these alternatives. */
  | (Base & { kind: 'chooseN'; n: number; of: Rule[] })
  /** N credits drawn from a set. Covers electives and "9 credits of CPSC 300+". */
  | (Base & { kind: 'credits'; n: number; from: CourseSet })
  /** Structure only — carries no requirement of its own. */
  | (Base & { kind: 'group'; items: Rule[] })
  /**
   * A real requirement we cannot evaluate. Shown to the student, never placed
   * by the solver, and never counted as satisfied. This exists so that an
   * un-modelled rule is visible rather than silently absent — the failure mode
   * that would let a plan claim a student can graduate when they cannot.
   */
  | (Base & { kind: 'note'; detail: string });

export type Program = {
  code: string;
  name: string;
  degree: string;
  faculty: string;
  catalogYear: string;
  /** Program codes whose rules are merged in ahead of this one's. */
  extends: string[];
  sourceUrl: string;
  rules: Rule[];
  /** Minimum credits for the credential as a whole. */
  totalCredits: number;
};

/** Depth-first walk, parents before children. */
export function walk(rules: Rule[], visit: (r: Rule) => void): void {
  for (const rule of rules) {
    visit(rule);
    if (rule.kind === 'group') walk(rule.items, visit);
    else if (rule.kind === 'chooseN') walk(rule.of, visit);
  }
}

/** Every rule id in a tree, for duplicate detection at seed time. */
export function ruleIds(rules: Rule[]): string[] {
  const ids: string[] = [];
  walk(rules, (r) => ids.push(r.id));
  return ids;
}

/**
 * Rules that a student must actually satisfy, flattened. Groups contribute
 * structure but no obligation of their own, so they are dropped; a chooseN is
 * kept whole because its obligation is the choice, not the branches.
 */
export function obligations(rules: Rule[]): Rule[] {
  const out: Rule[] = [];
  for (const rule of rules) {
    if (rule.kind === 'group') out.push(...obligations(rule.items));
    else out.push(rule);
  }
  return out;
}

/** A course as the guidance engine needs it — no Prisma types in the core. */
export type CourseRef = {
  id: string;
  subject: string;
  number: string;
  code: string;
  credits: number;
  faculty: string | null;
};

/** The numeric part of a course number, ignoring a trailing letter (491A). */
export function courseLevel(number: string): number {
  const m = /^(\d+)/.exec(number);
  return m ? Number(m[1]) : 0;
}

/** Whether a course falls in a set. */
export function matches(set: CourseSet, course: CourseRef): boolean {
  if (set.kind === 'codes') return set.codes.includes(course.code);
  if (set.exclude?.includes(course.code)) return false;
  if (set.subjects && !set.subjects.includes(course.subject)) return false;
  // A faculty pattern with no faculty data matches nothing rather than
  // everything — an unpopulated Subject.faculty must not silently turn
  // "12 credits of Arts" into "any 12 credits".
  if (set.faculty && course.faculty !== set.faculty) return false;
  const level = courseLevel(course.number);
  if (set.levelMin !== undefined && level < set.levelMin) return false;
  if (set.levelMax !== undefined && level > set.levelMax) return false;
  return true;
}

/** Every course in a catalogue that falls in a set. */
export function resolveSet(set: CourseSet, catalogue: CourseRef[]): CourseRef[] {
  return catalogue.filter((c) => matches(set, c));
}
