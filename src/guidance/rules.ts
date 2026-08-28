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
      /**
       * Whole subjects to remove, for a faculty pattern that does not want
       * all of its faculty. The B.Sc. Arts requirement is the case: Geography
       * sits in the Faculty of Arts, but the Calendar excludes GEOS from the
       * 12 Arts credits because those courses carry science credit instead.
       */
      excludeSubjects?: string[];
    };

type Base = {
  id: string;
  label: string;
  sourceUrl?: string;
  confidence?: Confidence;
  /**
   * A restriction on how other credits are spent, adding none of its own.
   *
   * "12 credits of Arts" and Science Breadth are both of this kind: a student
   * does not take 12 Arts credits ON TOP of their degree, they take 12 of
   * their elective credits in Arts. Counting them as additional obligations
   * inflated a 120-credit degree to 135 and added a year and a half to the
   * plan — the Calendar's own table sums to exactly 120 with electives in it.
   *
   * A constraint still appears in the checklist and still gets a slot in the
   * plan; the slot is drawn from the elective pool rather than added beside it.
   */
  constraint?: boolean;
  /**
   * Free credits, spendable on anything — the residual a program leaves after
   * its named requirements, and the only pool a `constraint` may be charged
   * against.
   *
   * This has to be declared rather than detected. Electives are written as a
   * credits rule over an empty code list, but so are real requirements whose
   * approved list has not been transcribed (the B.Sc. Additional
   * Communication Requirement, the Ways of Knowing breadth areas), and the
   * solver charged constraints against whichever of them came first. In the
   * Psychology major that silently ate the 6 credits of Behavioural
   * Neuroscience and the 12 further upper-level credits — 18 credits of
   * required psychology replaced by Ways of Knowing slots, with nothing
   * reported unplaced.
   */
  elective?: boolean;
  /**
   * The year of the degree the Calendar puts this requirement in.
   *
   * UBC already publishes a curated sequence — which courses pair well, which
   * crush a term — and the program tables state it directly. Deriving an
   * order from prerequisite depth instead reconstructs, badly, an answer we
   * were handed: it produced plans with CPSC 110 in fourth year, because
   * nothing in a prerequisite graph says an intro course belongs early.
   *
   * A rule may be pushed LATER than its year when a prerequisite is missing
   * or the course is not offered, and the plan says so. It is never pulled
   * earlier on its own; a student wanting to compress raises their credit
   * load, which is already a control.
   *
   * Inherited from the enclosing group, so only the year groups carry it.
   */
  year?: number;
};

export type Rule =
  /** One named course. */
  | (Base & {
      kind: 'course';
      code: string;
      /**
       * What the PROGRAM prices this course at, when that differs from the
       * catalogue.
       *
       * UBC has variable-credit courses — CPEN 221 is "(4-5)", ELEC 491 and
       * CPEN 491 are "(5-10)" — and the catalogue stores a single number,
       * the bottom of the range. A program table that requires the top of it
       * was first modelled as a credits rule over a one-code list, which got
       * the arithmetic right and broke everything downstream: a credits rule
       * plans as a SLOT, slots never enter the satisfied set, so CPEN 221 was
       * never taken and CPEN 212, 331 and 391 all became unreachable.
       */
      credits?: number;
    })
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

/**
 * Push each group's year down onto its children, so a rule can be read on its
 * own. Only the year groups declare it; nothing nested has to repeat it.
 */
export function withYears(rules: Rule[], inherited?: number): Rule[] {
  return rules.map((rule) => {
    const year = rule.year ?? inherited;
    if (rule.kind === 'group') {
      return { ...rule, year, items: withYears(rule.items, year) };
    }
    if (rule.kind === 'chooseN') {
      return { ...rule, year, of: withYears(rule.of, year) };
    }
    return { ...rule, year };
  });
}

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
  if (set.excludeSubjects?.includes(course.subject)) return false;
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
