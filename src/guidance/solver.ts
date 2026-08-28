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
  | {
      kind: 'course';
      course: CourseRef;
      forRules: string[];
      /**
       * The other courses that would satisfy the same requirement.
       *
       * A choice with seven branches — the calculus requirement has that many
       * — is shown as one course, and without this the plan reads as though
       * that course were the requirement. Carrying the alternatives lets the
       * page say "or one of these" instead of quietly deciding for the
       * student.
       */
      alternatives: string[];
    }
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
    const items = tree.items.map((i) => tightenNotes(i, codeToId) ?? i);
    // An AND whose parts are alternatives is an OR. parseRequirements splits
    // a lettered prerequisite on its semicolons and joins the pieces with
    // AND, so STAT 305's "Either (a) …; or (b) …; or (c) …" arrives demanding
    // all three at once — including DSCI 200, which a Statistics major never
    // takes, making the course unreachable. A part that opens with "or" is a
    // branch of the part before it, not an addition to it.
    const alternatives =
      tree.type === 'and' &&
      tree.items.filter((i) => i.type === 'note' && i.text.trimStart().toLowerCase().startsWith('or ')).length > 0;
    if (!alternatives) return { ...tree, items };
    // Prose that names no course is commentary — "The Department recommends
    // option (a)" — not a route. Harmless inside an AND, where a permissive
    // note changes nothing, but fatal inside an OR: one always-true branch
    // satisfies the whole prerequisite and the course becomes reachable with
    // nothing taken at all.
    const routes = items.filter((i) => i.type !== 'note');
    return { ...tree, type: 'or', items: routes.length > 0 ? routes : items };
  }
  if (tree.type !== 'note') return tree;

  // Lettered alternatives inside a single note. BIOL 200 reads "Either (a)
  // BIOL 112 and one of CHEM 123, CHEM 130 or (b) SCIE 001 or (c) 8 transfer
  // credits … or (d) …", all in one sentence, so the whole thing arrives as
  // one note rather than as an AND of several. Splitting it on "and" first
  // would join clauses that are alternatives, demanding branches (a) and (c)
  // and (d) together — which no student satisfies.
  //
  // Split on the "or (x)" markers before anything else, and read each branch
  // with the ordinary rules below.
  const branches = tree.text.split(/\bor\s*\([a-z]\)/i);
  if (branches.length > 1) {
    const parsed = branches
      .map((text) => tightenNotes({ type: 'note', text }, codeToId))
      .filter((r): r is Requirement => !!r && r.type !== 'note');
    if (parsed.length > 0) {
      return parsed.length === 1 ? parsed[0] : { type: 'or', items: parsed };
    }
    return tree;
  }

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
    // Labelled generically. Naming the category — "Science Breadth:
    // Chemistry" — reads as an instruction to take chemistry, when the
    // requirement is "any 6 of 7" and the choice is the student's. The
    // branch is still tracked so the count is right and no category is
    // offered twice; it just is not presented as the answer. Examples come
    // from the branch, as a hint rather than a prescription.
    return unmet.slice(0, left).map((b) => ({
      credits: b.n,
      label: rule.label.split(' — ')[0],
      examples: examplesFor(b),
      branchId: b.id,
    }));
  }

  return [];
}


/**
 * How many terms of prerequisite chain sit AHEAD of a course, within the set
 * this program actually requires.
 *
 * `depth` measures the chain behind a course; this measures the chain in
 * front. Together they give its float — the number of terms it could be
 * delayed without making the whole plan longer:
 *
 *     float = (planLength - 1 - height) - depth
 *
 * A course with zero float is on the critical path: CPSC 110 must go in term
 * one because 210, 213 and 310 queue behind it. A course with float to spare
 * can move later so an elective can sit beside it instead. This is the
 * distinction a plain greedy pass cannot make — it packs every required
 * course as early as possible, which is right for the critical path and
 * needless for everything else, and leaves the electives stacked at the end.
 */
function heights(
  required: CourseRef[],
  prereqs: Map<string, Requirement | null>,
): Map<string, number> {
  const ids = new Set(required.map((c) => c.id));
  // course -> the required courses that depend on it
  const dependents = new Map<string, string[]>();
  for (const c of required) {
    for (const need of treeCourseIds(prereqs.get(c.id))) {
      if (ids.has(need)) dependents.set(need, [...(dependents.get(need) ?? []), c.id]);
    }
  }
  const memo = new Map<string, number>();
  const walkUp = (id: string, seen: Set<string>): number => {
    if (memo.has(id)) return memo.get(id) as number;
    if (seen.has(id)) return 0; // a mis-parsed prereq could cycle
    const kids = dependents.get(id) ?? [];
    const h = kids.length === 0 ? 0 : 1 + Math.max(...kids.map((k) => walkUp(k, new Set([...seen, id]))));
    memo.set(id, h);
    return h;
  };
  return new Map(required.map((c) => [c.id, walkUp(c.id, new Set())]));
}

/** Every course id a prerequisite tree names, whatever the and/or shape. */
function treeCourseIds(tree: Requirement | null | undefined): string[] {
  if (!tree) return [];
  if (tree.type === 'course') return tree.courseId ? [tree.courseId] : [];
  if (tree.type === 'and' || tree.type === 'or') return tree.items.flatMap(treeCourseIds);
  return [];
}

/** A rule that names an amount rather than a course, and so plans as slots. */
function isSlotShaped(rule: Rule): boolean {
  return (
    rule.kind === 'credits' ||
    (rule.kind === 'chooseN' && rule.of.every((b) => b.kind === 'credits'))
  );
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

  /**
   * How long the plan has to be, and therefore how much slack exists.
   *
   * Two independent lower bounds: the credits owed divided by the term load,
   * and the longest prerequisite chain. The plan can be no shorter than
   * either, and the difference between them is the room available to move
   * flexible requirements around without costing a term.
   */
  // The CHEAPEST bundle per rule, not every alternative. Flattening them all
  // counts each of the seven calculus options as a separate obligation, which
  // roughly doubled the credits the plan thought it owed; that inflated the
  // plan length, which shrank every term's share, which starved each term to
  // a single course and stretched an eight-term degree to twelve.
  const requiredCourses = need
    .filter((n) => !isSlotShaped(n.p.rule))
    .flatMap((n) => bundlesFor(n.p.rule, input)[0] ?? []);
  const height = heights(requiredCourses, input.prereqs);
  const totalCreditsNeeded = need.reduce(
    (sum, n) =>
      sum +
      (isSlotShaped(n.p.rule)
        ? n.p.rule.kind === 'credits'
          ? n.left
          : constrainedCredits(n.p.rule, n.left)
        : 0),
    requiredCourses.reduce((sum, c) => sum + c.credits, 0),
  );
  const byCredits = Math.ceil(totalCreditsNeeded / Math.max(1, prefs.creditsPerTerm));
  const byChain = requiredCourses.reduce(
    (max, c) => Math.max(max, depth(c.id, input.prereqs) + (height.get(c.id) ?? 0) + 1),
    0,
  );
  const planLength = Math.max(byCredits, byChain, 1);
  /** chooseN branches already given a slot, so no category repeats. */
  const slotted = new Set<string>();

  // Constrained requirements are considered before the plain elective
  // buckets. A constraint is spent FROM the electives, so if the electives
  // hand out their own slots first and run dry, a later Arts slot finds
  // nothing to charge against and is added on top — the plan then carries
  // more credits than the degree asks for.
  need.sort((a, b) => Number(!!b.p.rule.constraint) - Number(!!a.p.rule.constraint));

  /**
   * Spend a constrained slot out of the elective allowance.
   *
   * Deducting the nominal total up front loses whatever a constraint never
   * spends. Science Breadth is nominally 18 credits, but a CS major covers
   * three of its six categories through required courses, so only 9 are ever
   * slotted — and the other 9 came off the electives and were never given
   * back. The plan totalled 111 credits of 120 for exactly that reason, while
   * reporting nothing unplaced.
   *
   * Charged as each slot is actually placed instead, against whichever
   * elective bucket still has room.
   */
  const spendFromElectives = (credits: number) => {
    // Charged across buckets until it is fully spent. Electives are split per
    // year, so one bucket often holds less than the charge; clamping at zero
    // against a single bucket loses the remainder, and the plan then places
    // those credits twice — once as the constraint and again as an elective
    // that was never charged for. That is how the totals ran over 120.
    let owed = credits;
    for (const bucket of need) {
      if (owed <= 0) break;
      const rule = bucket.p.rule;
      if (bucket.left <= 0 || rule.kind !== 'credits' || rule.constraint) continue;
      const taken = Math.min(bucket.left, owed);
      bucket.left -= taken;
      owed -= taken;
    }
  };

  for (const term of placeable) {
    if (need.every((n) => n.left <= 0)) break;
    const placements: Placement[] = [];

    let credits = 0;

    /**
     * Hold part of the term back for flexible requirements.
     *
     * Without this, required courses take every term they can reach and the
     * electives, Arts and breadth all pile into the final years — four terms
     * of nothing but slots, which is not how anyone takes a degree. The
     * Calendar spreads them too: its own tables put elective credits in every
     * year rather than saving them for the end.
     *
     * The reserve is what is still owed in slots divided by the terms left, so
     * it shrinks as those requirements are met and disappears once they are.
     * It is a floor on elective room, not a cap on progress: if the reserve
     * would leave a term unable to fit any required course, it is ignored —
     * delaying a prerequisite to make space for an elective costs a term
     * later, which is the trade this must not make.
     */
    // Sized from what the REQUIRED courses still need, not from the slots.
    // Reserving "slots divided by terms" looks equivalent and is not: it can
    // leave less room than the required courses need in a term, which pushes
    // them later and adds a term — the plan grew from eight to nine that way.
    // Deriving it from the required side guarantees by construction that the
    // course pass always has room for its fair share, and whatever is left is
    // genuinely spare and goes to electives.
    //
    // Recomputed each term, so a term that could not use its share hands the
    // surplus to the next one instead of losing it.
    // Which year of the degree this term belongs to. Two winter terms a year,
    // and a summer session sits inside the year it follows rather than
    // starting a new one.
    const yearOfTerm = Math.floor(planned.length / 2) + 1;
    let courseCredits = 0;
    let slotCredits = 0;
    const free = () => prefs.creditsPerTerm - courseCredits - slotCredits;

    // Two passes. Concrete courses first, because they sit in prerequisite
    // chains and a term lost to a flexible requirement delays everything
    // behind it; slots then top up whatever capacity is left. Placing them in
    // rule order instead filled first year with Arts and breadth and pushed
    // CPSC 110 into second year, which is not how anyone takes this degree.
    // A third pass tops the term back up. The share is a floor either side may
    // overshoot, and when the course pass does — two 3- and 4-credit courses
    // against a 6-credit share — the slot share no longer fits in what is
    // left, so the term closes a couple of credits short. A few credits lost
    // every term is a whole extra term across a degree, which is what turned
    // an eight-term plan into twelve. The top-up ignores the slot share and
    // simply fills whatever room the two metered passes left behind.
    for (const pass of ['courses', 'slots', 'topup'] as const) {
    for (const entry of need) {
      if (free() <= 0) break;
      if (entry.left <= 0) continue;
      const rule = entry.p.rule;
      const isSlotRule = isSlotShaped(rule);
      if (isSlotRule !== (pass !== 'courses')) continue;

      // Anchor to the Calendar's own sequence. UBC has already decided which
      // year a requirement belongs to and its tables say so; deriving an order
      // from prerequisite depth instead reconstructs that badly — it put
      // CPSC 110 in fourth year, because nothing in a prerequisite graph says
      // an intro course belongs early.
      //
      // Later than its year is allowed and happens naturally when a
      // prerequisite is missing or the course is not offered. Earlier is not:
      // a student wanting to compress raises their credit load instead.
      // The last year is open-ended, so a fourth-year rule is written year 3
      // and simply never blocks after that.
      if ((rule.year ?? 1) > yearOfTerm) continue;

      // A rule that names an amount rather than a course becomes a slot:
      // "3 credits of Arts". No prerequisites, so nothing to order.
      const covered = [
        ...input.completed,
        ...planned.flatMap((t) => t.placements.flatMap((pl) => (pl.kind === 'course' ? [pl.course] : []))),
        ...placements.flatMap((pl) => (pl.kind === 'course' ? [pl.course] : [])),
      ];

      // A choose-N of credit buckets has to re-count what it still owes as the
      // plan fills in. Science Breadth asks for 6 of 7 categories, and a CS
      // major covers Computer Science, Mathematics and Statistics through its
      // own required courses — but `left` was fixed at 6 when the plan began,
      // so those three never came off the tally and the rule reported itself
      // unplaceable no matter how many slots it was given.
      if (rule.kind === 'chooseN' && rule.of.every((b) => b.kind === 'credits')) {
        const met = rule.of.filter((b) => {
          if (b.kind !== 'credits') return false;
          if (slotted.has(b.id)) return true;
          const earned = covered
            .filter((c) => matches(b.from, c))
            .reduce((n, c) => n + c.credits, 0);
          return earned >= b.n;
        }).length;
        entry.left = Math.max(0, rule.n - met);
        if (entry.left <= 0) continue;
      }

      const specs = slotSpecs(rule, entry.left, input, covered, slotted);
      if (isSlotRule) {
        // Never fall through to concrete placement. A slot rule that produces
        // no spec this term — every breadth category already slotted, say —
        // must simply wait, not start placing individual courses out of its
        // own course set. That is what put MATH 120 and MATH 398 in fourth
        // year long after the calculus requirement was met.
        // At most one slot per requirement per term. Without this the Arts
        // rule empties its whole 12 credits into the first term with room —
        // four Arts courses in one term of a CS degree, which nobody takes.
        // Spreading them is also more honest: they are a requirement to meet
        // over the degree, not a block to clear in one go.
        // One per requirement in the spreading pass, unlimited in the top-up.
        // The cap is what stops the Arts rule emptying its 12 credits into the
        // first term with room; lifting it for the top-up is what stops the
        // last terms trailing off at 9, 6 and 5 credits once only a couple of
        // requirements are left to draw from.
        const cap = pass === 'topup' ? Infinity : 1;
        let placedForRule = 0;
        for (let spec of specs) {
          if (placedForRule >= cap) break;
          // A slot may shrink to close the term. Slots come in threes and the
          // gaps left by 3- and 4-credit courses are ones and twos, so a term
          // finishes a credit or two short and those credits queue up until
          // they need a term of their own — five of them across four terms
          // became a ninth term holding five credits. Shrinking is honest:
          // UBC has 1- and 2-credit courses, so "2 credits of electives" is a
          // real instruction. Only on the top-up, where the alternative is
          // leaving the credits stranded.
          if (spec.credits > free()) {
            if (pass !== 'topup' || free() < 1) break;
            spec = { ...spec, credits: free() };
          }
          const { branchId, ...rest } = spec as typeof spec & { branchId?: string };
          placements.push({ kind: 'slot', ...rest, forRules: [rule.id] });
          if (branchId) slotted.add(branchId);
          slotCredits += spec.credits;
          placedForRule++;
          entry.left -= rule.kind === 'credits' ? spec.credits : 1;
          if (rule.constraint) spendFromElectives(spec.credits);
        }
        continue;
      }

      for (const bundle of bundlesFor(rule, input)) {
        // A bundle is all-or-nothing, so it needs room for the whole thing.
        const cost = bundle.reduce((n, c) => n + c.credits, 0);
        // A bundle with no float is on the critical path: delaying it makes
        // the whole plan longer, so it takes the reserved elective room
        // rather than waiting for it. Everything else respects the reserve,
        // which is what leaves an elective beside it instead of four terms of
        // slots at the end.
        const slack = Math.min(
          ...bundle.map(
            (c) => planLength - 1 - (height.get(c.id) ?? 0) - depth(c.id, input.prereqs),
          ),
        );
        // The term's share of required credits is a floor it may overshoot by
        // one course, never a ceiling it must fit inside. Courses come in 3
        // and 4 credit lumps and a share is rarely a multiple of either, so
        // treating it as a hard cap means a 4-credit course cannot start
        // against a 6-credit share — one course a term, and a twelve-term
        // plan. Placing while still under the share, and stopping once past
        // it, spreads the work without ever starving a term.
        //
        // Zero slack overrides both: a course on the critical path delays the
        // whole plan if it waits, so it takes whatever room is left.
        if (cost > free()) continue;
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

        // Sibling branches of the same choice, as codes. A group branch —
        // "CPSC 103 and 107" — is joined so it reads as the pair it is.
        const alternatives =
          rule.kind === 'chooseN'
            ? rule.of
                .map((b) =>
                  b.kind === 'course'
                    ? b.code
                    : b.kind === 'group'
                      ? b.items.map((i) => (i.kind === 'course' ? i.code : '')).filter(Boolean).join(' + ')
                      : '',
                )
                .filter((c) => c && !bundle.some((x) => x.code === c))
            : [];
        for (const course of bundle) {
          placements.push({ kind: 'course', course, forRules: [rule.id], alternatives });
          placedIds.add(course.id);
          courseCredits += course.credits;
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
