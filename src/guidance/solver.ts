import { type CourseRef, type Rule, matches } from '@/guidance/rules';
import type { Requirement } from '@/prereqs/parse';
import type { RuleProgress } from '@/guidance/progress';

/** A term the plan can place courses into, in chronological order. */
export type PlanTerm = {
  id: string;
  name: string;
  /**
   * Whether coursework can be placed here at all. Co-op work terms are the
   * reason this is data rather than an assumption: a co-op student's plan has
   * to skip a term and keep placing around it. Nothing sets this to false yet.
   */
  available: boolean;
  /**
   * A term beyond the catalogue's horizon. UBC only publishes sections a year
   * or so out, but a degree takes four — so the later half of any roadmap is
   * necessarily projected. Offerings are unknown for these, and the solver
   * places into them freely rather than refusing, which would leave the plan
   * stopping halfway through second year.
   */
  projected?: boolean;
};

export type Prefs = {
  /** Courses per term. */
  load: number;
  useSummer: boolean;
  /** Term id to finish by, or null for "as early as possible". */
  targetTermId: string | null;
};

export type Placement = {
  course: CourseRef;
  /** Rule ids this placement works toward. */
  forRules: string[];
};

export type PlannedTerm = { term: PlanTerm; placements: Placement[] };

export type Plan = {
  terms: PlannedTerm[];
  /** Requirements the solver could not place, with why. */
  unplaced: { rule: Rule; reason: string }[];
  /** Non-fatal things the student should know. */
  warnings: string[];
};

export type SolverInput = {
  outstanding: RuleProgress[];
  /** Courses already passed — prerequisites may be satisfied by these. */
  completed: CourseRef[];
  catalogue: CourseRef[];
  /**
   * courseId -> its parsed prerequisite tree. The tree, not CoursePrereqEdge:
   * the edge table flattens "one of A, B" into two edges and requiring both
   * makes the course unreachable.
   */
  prereqs: Map<string, Requirement | null>;
  /** courseId -> term ids where it is actually offered. */
  offerings: Map<string, Set<string>>;
  terms: PlanTerm[];
  prefs: Prefs;
};

/**
 * Whether a prerequisite tree is satisfied by a set of completed course ids.
 *
 * This must read the TREE and not `CoursePrereqEdge`. That table is a
 * flattened graph: CPSC 210's real prerequisite is "One of CPSC 107, CPSC 110"
 * but it stores two edges, and requiring both demands a pair no student takes.
 * Gating on the edges silently made most of a CS degree unplaceable.
 *
 * A `note` is eligibility prose — standing, permission, a grade floor — not a
 * course dependency, so it cannot be checked here and must not block.
 * Likewise a course reference the parser could not resolve to an id.
 */
/** SUBJ[_CAMPUS] NNN[letter], the same shape src/prereqs/parse.ts matches. */
const CODE_IN_TEXT = /\b([A-Z]{2,5})(?:_[A-Z])?\s?(\d{2,3}[A-Z]?)\b/g;

/**
 * Rewrite `note` nodes that actually name courses into course requirements.
 *
 * `parseRequirements` bails to a verbatim note whenever it meets "either",
 * "N of" or a lettered alternative — so CPSC 313's real prerequisite,
 * "CPSC 213 and either CPSC 221 or DSCI 221", arrives here as prose. Treating
 * that as non-blocking let the solver put 313 in the same term as 213.
 *
 * Notes that name no course at all ("Third-year standing") are left alone:
 * those are eligibility, not ordering, and must not block.
 *
 * The prose is regular enough to read structurally: UBC writes these as
 * conjunctions of alternatives — "CPSC 213 and either CPSC 221 or DSCI 221",
 * "One of CPSC 210, CPSC 260 and one of CPSC 121, MATH 220". Splitting on
 * top-level "and" and treating each segment as an OR over the codes it names
 * reproduces both correctly.
 *
 * ponytail: a text split, not a grammar. It gets the two shapes above right
 * and will mis-read anything with nested or inverted grouping. Codes outside
 * the loaded catalogue resolve to nothing and drop out of their segment; a
 * segment left with no codes is dropped rather than blocking. Upgrade path is
 * teaching parseRequirements to handle "either"/"N of" so no note reaches here
 * carrying course codes at all.
 */
export function tightenNotes(
  tree: Requirement | null | undefined,
  codeToId: Map<string, string>,
): Requirement | null {
  if (!tree) return null;
  if (tree.type === 'and' || tree.type === 'or') {
    return { ...tree, items: tree.items.map((i) => tightenNotes(i, codeToId) ?? i) };
  }
  if (tree.type !== 'note') return tree;

  const segments: Requirement[] = [];
  for (const segment of tree.text.split(/\band\b/i)) {
    const options: Requirement[] = [];
    for (const m of segment.matchAll(CODE_IN_TEXT)) {
      const code = `${m[1]} ${m[2]}`;
      const id = codeToId.get(code);
      if (id && !options.some((o) => o.type === 'course' && o.courseId === id)) {
        options.push({ type: 'course', code, courseId: id });
      }
    }
    if (options.length === 1) segments.push(options[0]);
    else if (options.length > 1) segments.push({ type: 'or', items: options });
  }

  if (segments.length === 0) return tree; // genuine eligibility prose
  return segments.length === 1 ? segments[0] : { type: 'and', items: segments };
}

export function treeMet(tree: Requirement | null | undefined, satisfied: Set<string>): boolean {
  if (!tree) return true;
  switch (tree.type) {
    case 'course':
      return tree.courseId ? satisfied.has(tree.courseId) : true;
    case 'and':
      return tree.items.every((i) => treeMet(i, satisfied));
    case 'or':
      return tree.items.some((i) => treeMet(i, satisfied));
    case 'note':
      return true;
  }
}

/**
 * How deep a course sits in the prerequisite graph — the ordering that stops
 * the plan suggesting CPSC 310 before CPSC 210.
 *
 * An `or` takes the MINIMUM of its branches, because a student only has to
 * walk the cheapest one; an `and` takes the maximum. Using the flattened edge
 * table here would overstate the depth of every course with alternatives.
 *
 * Cycles cannot occur in a well-formed catalogue, but a mis-parsed prereq
 * could create one, so the walk carries a seen-set and stops rather than
 * recursing forever.
 */
export function depth(
  courseId: string,
  trees: Map<string, Requirement | null>,
  seen: Set<string> = new Set(),
): number {
  if (seen.has(courseId)) return 0;
  return treeDepth(trees.get(courseId), trees, new Set([...seen, courseId]));
}

function treeDepth(
  tree: Requirement | null | undefined,
  trees: Map<string, Requirement | null>,
  seen: Set<string>,
): number {
  if (!tree) return 0;
  switch (tree.type) {
    case 'course':
      return tree.courseId && !seen.has(tree.courseId) ? 1 + depth(tree.courseId, trees, seen) : 0;
    case 'and': {
      const d = tree.items.map((i) => treeDepth(i, trees, seen));
      return d.length ? Math.max(...d) : 0;
    }
    case 'or': {
      const d = tree.items.map((i) => treeDepth(i, trees, seen));
      return d.length ? Math.min(...d) : 0;
    }
    case 'note':
      return 0;
  }
}

/** Candidate courses that would advance a rule, best first. */
function candidatesFor(
  p: RuleProgress,
  input: SolverInput,
): CourseRef[] {
  const { rule } = p;
  if (rule.kind === 'course') {
    const c = input.catalogue.find((x) => x.code === rule.code);
    return c ? [c] : [];
  }
  if (rule.kind === 'chooseN') {
    // Any single branch satisfies one unit of the choice. Shallowest first —
    // an alternative with fewer prerequisites is genuinely easier to fit.
    return rule.of
      .flatMap((b) => (b.kind === 'course' ? input.catalogue.filter((x) => x.code === b.code) : []))
      .sort((a, b) => depth(a.id, input.prereqs) - depth(b.id, input.prereqs));
  }
  if (rule.kind === 'credits') {
    return input.catalogue
      .filter((c) => matches(rule.from, c))
      .sort((a, b) => depth(a.id, input.prereqs) - depth(b.id, input.prereqs));
  }
  return [];
}

/** How many credits a rule still needs; 1 "unit" for non-credit rules. */
function remaining(p: RuleProgress): number {
  if (p.rule.kind === 'credits') return (p.credits?.needed ?? 0) - (p.credits?.earned ?? 0);
  if (p.rule.kind === 'chooseN') return Math.max(0, p.rule.n - p.satisfiedBy.length);
  return 1;
}

/**
 * Build a term-by-term plan.
 *
 * Greedy rather than optimal: walk the placeable terms in order and, for each,
 * take the deepest-in-the-graph courses whose prerequisites are already met by
 * completions plus everything placed so far, and which are actually offered
 * that term. A student wants a plan that works, not the provably shortest one,
 * and a greedy pass is easy to explain when it refuses to place something.
 */
export function solve(input: SolverInput): Plan {
  const { prefs } = input;
  const placeable = input.terms.filter(
    (t) => t.available && (prefs.useSummer || !/summer/i.test(t.name)),
  );

  const satisfied = new Set(input.completed.map((c) => c.id));
  const need = input.outstanding
    .filter((p) => p.rule.kind !== 'note' && p.rule.kind !== 'group')
    .map((p) => ({ p, left: remaining(p) }))
    .filter((x) => x.left > 0);

  const planned: PlannedTerm[] = [];
  const placedIds = new Set<string>();

  for (const term of placeable) {
    if (need.every((n) => n.left <= 0)) break;
    const placements: Placement[] = [];

    for (const entry of need) {
      if (placements.length >= prefs.load) break;
      if (entry.left <= 0) continue;

      for (const course of candidatesFor(entry.p, input)) {
        if (placements.length >= prefs.load) break;
        if (placedIds.has(course.id) || satisfied.has(course.id)) continue;

        // Offered this term? Only enforced where we actually know — a
        // projected term has no section data, and treating "unknown" as
        // "not offered" would stop the plan at the catalogue's horizon.
        if (!term.projected) {
          const when = input.offerings.get(course.id);
          if (when && when.size > 0 && !when.has(term.id)) continue;
        }

        // Prerequisites met by completions plus everything placed in an
        // EARLIER term. Courses placed in this same term do not count — two
        // courses in one term cannot satisfy each other.
        if (!treeMet(input.prereqs.get(course.id), satisfied)) continue;

        placements.push({ course, forRules: [entry.p.rule.id] });
        placedIds.add(course.id);
        entry.left -= entry.p.rule.kind === 'credits' ? course.credits : 1;
        if (entry.left <= 0) break;
      }
    }

    if (placements.length > 0) planned.push({ term, placements });
    // Only now do this term's courses become prerequisites for later terms.
    for (const pl of placements) satisfied.add(pl.course.id);

    if (prefs.targetTermId && term.id === prefs.targetTermId) break;
  }

  const unplaced = need
    .filter((n) => n.left > 0)
    .map((n) => ({
      rule: n.p.rule,
      reason:
        n.p.rule.kind === 'credits'
          ? `${n.left} credits still unplaced — no offered course fits the remaining terms`
          : 'no offered term found where its prerequisites are met first',
    }));

  const warnings: string[] = [];
  const notes = input.outstanding.filter((p) => p.rule.kind === 'note');
  if (notes.length > 0) {
    warnings.push(
      `${notes.length} requirement${notes.length === 1 ? '' : 's'} cannot be checked automatically — confirm with an advisor.`,
    );
  }
  if (prefs.targetTermId && unplaced.length > 0) {
    warnings.push('Not everything fits before your target term at this course load.');
  }

  return { terms: planned, unplaced, warnings };
}
