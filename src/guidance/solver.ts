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
  /**
   * Credits per term, not courses.
   *
   * A degree is measured in credits and UBC states load the same way — 15 is
   * a standard full-time term, 30 a year, 120 a four-year degree. Counting
   * courses instead made a 4-credit CPSC course and a 3-credit elective slot
   * cost the same, and a default of "4 courses" quietly meant 12 credits a
   * term, which stretches a four-year degree to five.
   */
  creditsPerTerm: number;
  useSummer: boolean;
  /** Term id to finish by, or null for "as early as possible". */
  targetTermId: string | null;
};

/**
 * One thing to do in a term. Either a specific course, or a slot — "3 credits
 * of Arts" — for a requirement that names an amount rather than a course.
 *
 * Slots are not a fallback for the unresolvable; they are the honest form for
 * a whole class of requirement. Breadth and elective rules say how much, not
 * which, and picking a particular course to fill them is a guess presented as
 * advice. It is also what produced graduate seminars in a third-year term
 * before the level caps went in. A slot has no prerequisites, so it needs no
 * ordering — which is why this is easier than concrete placement, not harder.
 */
export type Placement =
  | { kind: 'course'; course: CourseRef; forRules: string[] }
  | {
      kind: 'slot';
      credits: number;
      label: string;
      /** A few real courses that would fit, to make the slot actionable. */
      examples: CourseRef[];
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

/**
 * The course sets a rule could be advanced by, best first.
 *
 * Each entry is a BUNDLE — one alternative, which may be more than one course.
 * "CPSC 110, or CPSC 103 and 107" offers two: [110] and [103, 107]. An earlier
 * version flattened only the single-course branches and silently dropped the
 * multi-course ones, so a program whose only viable route was a pair could
 * never be planned. It failed safely (reported unplaceable rather than
 * inventing a plan), which is why it went unnoticed.
 */
function bundlesFor(rule: Rule, input: SolverInput): CourseRef[][] {
  const byCode = (code: string) => input.catalogue.find((x) => x.code === code);

  if (rule.kind === 'course') {
    const c = byCode(rule.code);
    return c ? [[c]] : [];
  }

  if (rule.kind === 'group') {
    // Every member is required, so the group is a single all-or-nothing bundle.
    const parts = rule.items.flatMap((i) => bundlesFor(i, input));
    const flat = parts.map((b) => b[0]).filter(Boolean);
    return flat.length === parts.length && flat.length > 0 ? [flat] : [];
  }

  if (rule.kind === 'chooseN') {
    return rule.of
      .flatMap((b) => bundlesFor(b, input))
      .sort((a, b) => cost(a, input) - cost(b, input));
  }

  if (rule.kind === 'credits') {
    return input.catalogue
      .filter((c) => matches(rule.from, c))
      .sort((a, b) => depth(a.id, input.prereqs) - depth(b.id, input.prereqs))
      .map((c) => [c]);
  }

  return [];
}

/** Prefer the alternative that is cheapest to reach: shallowest, then fewest courses. */
function cost(bundle: CourseRef[], input: SolverInput): number {
  const d = Math.max(0, ...bundle.map((c) => depth(c.id, input.prereqs)));
  return d * 10 + bundle.length;
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

/**
 * Slot specifications for a rule that names an amount rather than a course.
 *
 * Two shapes qualify. A plain `credits` rule is one bucket. A `chooseN` whose
 * branches are all credit rules — Science Breadth, "3 credits from any 6 of 7
 * categories" — is a set of buckets, and only the categories the student has
 * not already covered should appear. A CS major covers the Computer Science,
 * Mathematics and Statistics categories through their major courses; offering
 * them breadth slots for those would be telling them to do work they have
 * already done.
 */
function slotSpecs(
  rule: Rule,
  left: number,
  input: SolverInput,
  covered: CourseRef[],
  alreadySlotted: Set<string>,
): { credits: number; label: string; examples: CourseRef[] }[] {
  const examplesFor = (r: Extract<Rule, { kind: 'credits' }>) =>
    input.catalogue.filter((c) => matches(r.from, c)).slice(0, 3);

  if (rule.kind === 'credits') {
    const out = [];
    let need = left;
    while (need > 0) {
      const size = Math.min(SLOT_CREDITS, need);
      out.push({ credits: size, label: rule.label, examples: examplesFor(rule) });
      need -= size;
    }
    return out;
  }

  if (rule.kind === 'chooseN' && rule.of.every((b) => b.kind === 'credits')) {
    const branches = rule.of as Extract<Rule, { kind: 'credits' }>[];
    const unmet = branches.filter((b) => {
      // A category already given a slot in an earlier term is spoken for.
      // Without this the same category is offered again every term until the
      // choose-6 count runs out, and a student sees Chemistry twice.
      if (alreadySlotted.has(b.id)) return false;
      const earned = covered.filter((c) => matches(b.from, c)).reduce((s, c) => s + c.credits, 0);
      return earned < b.n;
    });
    return unmet.slice(0, left).map((b) => ({
      credits: b.n,
      label: `${rule.label.split(' — ')[0]}: ${b.label}`,
      examples: examplesFor(b),
      branchId: b.id,
    }));
  }

  return [];
}

/** Credits a constraint will consume from the elective allowance. */
function constrainedCredits(rule: Rule, left: number): number {
  if (rule.kind === 'credits') return left;
  // A choose-N of credit buckets: `left` counts branches still needed.
  if (rule.kind === 'chooseN') {
    const branch = rule.of[0];
    return branch?.kind === 'credits' ? branch.n * left : 0;
  }
  return 0;
}

/** Slots are sized to a typical UBC course. */
const SLOT_CREDITS = 3;

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
  /** chooseN branches already given a slot, so no category repeats. */
  const slotted = new Set<string>();

  /**
   * The elective allowance a constraint is spent from. A student meeting
   * "12 credits of Arts" is spending electives on Arts, not taking 12 credits
   * beyond the degree — so placing a constraint slot has to draw the pool
   * down too, or the plan runs long by exactly the constrained credits.
   *
   * The pool is the largest unconstrained credit bucket, which is the
   * Electives row in every program shaped like this one.
   */
  const pool = need
    .filter((n) => n.p.rule.kind === 'credits' && !n.p.rule.constraint)
    .sort((a, b) => b.left - a.left)[0];
  if (pool) {
    // Once, up front, rather than per placement. Doing it as each constraint
    // slot lands needs the constrained buckets to be placed first, and gating
    // on that starves any term where no constraint happens to fit — which left
    // terms holding a single course. The totals are what matter, so settle
    // them before placing anything.
    const constrained = need
      .filter((n) => n.p.rule.constraint)
      .reduce((sum, n) => sum + constrainedCredits(n.p.rule, n.left), 0);
    pool.left = Math.max(0, pool.left - constrained);
  }

  for (const term of placeable) {
    if (need.every((n) => n.left <= 0)) break;
    const placements: Placement[] = [];

    let credits = 0;
    const room = () => prefs.creditsPerTerm - credits;

    // Two passes. Concrete courses first, because they sit in prerequisite
    // chains and a term lost to a flexible requirement delays everything
    // behind it; slots then top up whatever capacity is left. Placing them in
    // rule order instead filled first year with Arts and breadth and pushed
    // CPSC 110 into second year, which is not how anyone takes this degree.
    for (const pass of ['courses', 'slots'] as const) {
    for (const entry of need) {
      if (room() <= 0) break;
      if (entry.left <= 0) continue;
      const rule = entry.p.rule;
      const isSlotRule =
        rule.kind === 'credits' ||
        (rule.kind === 'chooseN' && rule.of.every((b) => b.kind === 'credits'));
      if (isSlotRule !== (pass === 'slots')) continue;

      // A rule that names an amount rather than a course becomes a slot:
      // "3 credits of Arts". No prerequisites, so nothing to order.
      const specs = slotSpecs(rule, entry.left, input, [
        ...input.completed,
        ...planned.flatMap((t) => t.placements.flatMap((pl) => (pl.kind === 'course' ? [pl.course] : []))),
        ...placements.flatMap((pl) => (pl.kind === 'course' ? [pl.course] : [])),
      ], slotted);
      if (isSlotRule) {
        // Never fall through to concrete placement. A slot rule that produces
        // no spec this term — every breadth category already slotted, say —
        // must simply wait, not start placing individual courses out of its
        // own course set. That is what put MATH 120 and MATH 398 in fourth
        // year long after the calculus requirement was met.
        for (const spec of specs) {
          if (spec.credits > room()) break;
          const { branchId, ...rest } = spec as typeof spec & { branchId?: string };
          placements.push({ kind: 'slot', ...rest, forRules: [rule.id] });
          if (branchId) slotted.add(branchId);
          credits += spec.credits;
          entry.left -= rule.kind === 'credits' ? spec.credits : 1;
        }
        continue;
      }

      for (const bundle of bundlesFor(rule, input)) {
        // A bundle is all-or-nothing, so it needs room for the whole thing.
        if (bundle.reduce((n, c) => n + c.credits, 0) > room()) continue;
        if (bundle.some((c) => placedIds.has(c.id) || satisfied.has(c.id))) continue;

        // Offered this term? Only enforced where we actually know — a
        // projected term has no section data, and treating "unknown" as
        // "not offered" would stop the plan at the catalogue's horizon.
        const offered = bundle.every((c) => {
          if (term.projected) return true;
          const when = input.offerings.get(c.id);
          return !when || when.size === 0 || when.has(term.id);
        });
        if (!offered) continue;

        // Prerequisites met by completions plus everything placed in an
        // EARLIER term. Courses placed in this same term do not count — two
        // courses in one term cannot satisfy each other.
        if (!bundle.every((c) => treeMet(input.prereqs.get(c.id), satisfied))) continue;

        for (const course of bundle) {
          placements.push({ kind: 'course', course, forRules: [rule.id] });
          placedIds.add(course.id);
          credits += course.credits;
        }
        entry.left -= 1;
        break; // one alternative satisfies the rule
      }
    }
    }

    if (placements.length > 0) planned.push({ term, placements });
    // Only now do this term's courses become prerequisites for later terms.
    for (const pl of placements) if (pl.kind === 'course') satisfied.add(pl.course.id);

    if (prefs.targetTermId && term.id === prefs.targetTermId) break;
  }

  const unplaced = need
    .filter((n) => n.left > 0)
    .map((n) => ({
      rule: n.p.rule,
      reason:
        n.p.rule.kind === 'credits'
          ? `${n.left} credits still unplaced — not enough terms at this credit load`
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
    warnings.push('Not everything fits before your target term at this credit load.');
  }

  return { terms: planned, unplaced, warnings };
}
