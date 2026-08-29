import { type CourseRef, type Rule, matches, obligations } from '@/guidance/rules';

/**
 * What a student has done with a course. Only `passed` and `transfer` count
 * toward a requirement — the distinction the Enrollment table cannot currently
 * make, and the reason a failed course must stay on the roadmap.
 */
export type Completion = {
  course: CourseRef;
  status: 'passed' | 'transfer' | 'failed' | 'in_progress' | 'withdrawn';
};

export type RuleState = 'satisfied' | 'partial' | 'outstanding' | 'unevaluated';

export type RuleProgress = {
  rule: Rule;
  state: RuleState;
  /** Courses the student already holds that count toward this rule. */
  satisfiedBy: CourseRef[];
  /** For credit rules: credits earned and needed. */
  credits?: { earned: number; needed: number };
  /** Human-readable, for the UI. */
  detail: string;
};

const COUNTS = new Set(['passed', 'transfer']);

/** Completions that count toward requirements. */
export function earned(completions: Completion[]): CourseRef[] {
  return completions.filter((c) => COUNTS.has(c.status)).map((c) => c.course);
}

/**
 * Evaluate one rule against what a student holds.
 *
 * `claimed` is mutated: a course spent on one rule is not available to another.
 * Degree requirements are largely disjoint, so first-come is adequate and
 * predictable. It is not optimal — a course eligible for two rules is assigned
 * to whichever is evaluated first, which can under-report progress in the rare
 * overlapping case. Recorded rather than solved, because the honest direction
 * to be wrong in is "you still owe this".
 */
function evaluate(rule: Rule, held: CourseRef[], claimed: Set<string>): RuleProgress {
  const free = held.filter((c) => !claimed.has(c.id));

  switch (rule.kind) {
    case 'course': {
      const hit = free.find((c) => c.code === rule.code);
      if (hit) claimed.add(hit.id);
      return {
        rule,
        state: hit ? 'satisfied' : 'outstanding',
        satisfiedBy: hit ? [hit] : [],
        detail: hit ? rule.code : `${rule.code}: outstanding`,
      };
    }

    case 'chooseN': {
      const branches = rule.of.map((b) => evaluate(b, held, claimed));
      const met = branches.filter((b) => b.state === 'satisfied');
      const state =
        met.length >= rule.n ? 'satisfied' : met.length > 0 ? 'partial' : 'outstanding';
      return {
        rule,
        state,
        satisfiedBy: met.flatMap((b) => b.satisfiedBy),
        detail: `${met.length} of ${rule.n} covered`,
      };
    }

    case 'credits': {
      const eligible = free.filter((c) => matches(rule.from, c));
      let earnedCredits = 0;
      const used: CourseRef[] = [];
      for (const c of eligible) {
        if (earnedCredits >= rule.n) break;
        earnedCredits += c.credits;
        used.push(c);
        claimed.add(c.id);
      }
      const state =
        earnedCredits >= rule.n ? 'satisfied' : earnedCredits > 0 ? 'partial' : 'outstanding';
      return {
        rule,
        state,
        satisfiedBy: used,
        credits: { earned: earnedCredits, needed: rule.n },
        detail: `${earnedCredits} of ${rule.n} credits`,
      };
    }

    case 'note':
      // Never satisfied, never planned. Visible so it cannot be silently
      // dropped from a student's picture of what they owe.
      return { rule, state: 'unevaluated', satisfiedBy: [], detail: rule.detail };

    case 'group': {
      const kids = rule.items.map((k) => evaluate(k, held, claimed));
      const real = kids.filter((k) => k.state !== 'unevaluated');
      const state = real.every((k) => k.state === 'satisfied')
        ? 'satisfied'
        : real.some((k) => k.state !== 'outstanding')
          ? 'partial'
          : 'outstanding';
      return {
        rule,
        state,
        satisfiedBy: kids.flatMap((k) => k.satisfiedBy),
        detail: `${real.filter((k) => k.state === 'satisfied').length} of ${real.length} covered`,
      };
    }
  }
}

/**
 * Progress across a program's whole rule set.
 *
 * Rules are evaluated in order, so a program file should list its most
 * specific requirements before its catch-all credit rules — otherwise an
 * elective bucket can swallow a course a named requirement needed.
 */
export function progress(completions: Completion[], rules: Rule[]): RuleProgress[] {
  const held = earned(completions);
  const claimed = new Set<string>();
  return rules.map((r) => evaluate(r, held, claimed));
}

/** The flattened obligations a student has not yet met. */
export function outstanding(completions: Completion[], rules: Rule[]): RuleProgress[] {
  const held = earned(completions);
  const claimed = new Set<string>();
  return obligations(rules)
    .map((r) => evaluate(r, held, claimed))
    .filter((p) => p.state === 'outstanding' || p.state === 'partial');
}
