import { type CourseSet, type Program, type Rule, walk } from '@/guidance/rules';

/**
 * Structural checks on a program file. Pure — no database, no network — so it
 * runs in the test suite and fails a build rather than a student's plan.
 *
 * These catch the mistakes a transcription actually makes: a duplicated rule
 * id that makes progress silently overwrite itself, a choose-N that asks for
 * more branches than it offers, a credit rule of zero credits that can never
 * be outstanding, an `extends` pointing at a program that does not exist.
 */

export type Issue = { severity: 'error' | 'warning'; ruleId: string; message: string };

/** Course codes a rule tree names, for cross-checking against the source. */
export function codesIn(rules: Rule[]): string[] {
  const codes = new Set<string>();
  walk(rules, (r) => {
    if (r.kind === 'course') codes.add(r.code);
    if (r.kind === 'credits' && r.from.kind === 'codes') r.from.codes.forEach((c) => codes.add(c));
    if (r.kind === 'credits' && r.from.kind === 'pattern') {
      r.from.exclude?.forEach((c) => codes.add(c));
    }
  });
  return [...codes];
}

function setIsEmpty(set: CourseSet): boolean {
  if (set.kind === 'codes') return set.codes.length === 0;
  return !set.subjects?.length && !set.faculty && set.levelMin === undefined && set.levelMax === undefined;
}

export function validateProgram(program: Program, known: Set<string>): Issue[] {
  const issues: Issue[] = [];
  const seen = new Set<string>();

  for (const code of program.extends) {
    if (!known.has(code)) {
      issues.push({
        severity: 'error',
        ruleId: program.code,
        message: `extends "${code}", which is not a known program`,
      });
    }
  }

  /**
   * Depth-first, carrying down the nearest ancestor's source page.
   *
   * A choose-N branch almost never cites a page of its own, and it does not
   * need to: the choice above it cites the page that names the whole choice,
   * and the branch is one line of it. Warning per branch buried the real
   * warnings — 237 of them across sixteen programs, every one a false alarm.
   */
  const visit = (rules: Rule[], inheritedSource?: string) => {
    for (const rule of rules) {
      check(rule, rule.sourceUrl ?? inheritedSource);
      const source = rule.sourceUrl ?? inheritedSource;
      if (rule.kind === 'group') visit(rule.items, source);
      else if (rule.kind === 'chooseN') visit(rule.of, source);
    }
  };

  function check(rule: Rule, source: string | undefined) {
    if (seen.has(rule.id)) {
      // Progress keys off rule id; a duplicate makes one rule silently
      // shadow the other and under-report what a student still owes.
      issues.push({ severity: 'error', ruleId: rule.id, message: 'duplicate rule id' });
    }
    seen.add(rule.id);

    if (!rule.label.trim()) {
      issues.push({ severity: 'error', ruleId: rule.id, message: 'empty label' });
    }
    if (!source) {
      issues.push({
        severity: 'warning',
        ruleId: rule.id,
        message: 'no sourceUrl — cannot be traced back to the Calendar',
      });
    }

    if (rule.kind === 'chooseN') {
      if (rule.n < 1) {
        issues.push({ severity: 'error', ruleId: rule.id, message: `chooses ${rule.n}` });
      }
      if (rule.n > rule.of.length) {
        issues.push({
          severity: 'error',
          ruleId: rule.id,
          message: `chooses ${rule.n} of only ${rule.of.length} options — can never be satisfied`,
        });
      }
    }

    if (rule.kind === 'credits') {
      if (rule.n <= 0) {
        issues.push({ severity: 'error', ruleId: rule.id, message: `requires ${rule.n} credits` });
      }
      // An elective is unconstrained by definition — that is what makes it
      // free credit — so saying so for every one of them is noise, not a
      // finding. The warning is for a REQUIREMENT that plans as a bare slot,
      // which means its approved list has not been transcribed yet.
      if (setIsEmpty(rule.from) && !rule.elective) {
        // Not an error: the Communication top-up is deliberately an empty set
        // because the approved list is not transcribed, and it plans as a slot.
        issues.push({
          severity: 'warning',
          ruleId: rule.id,
          message: 'course set is unconstrained — will plan as a slot with no examples',
        });
      }
    }

    if (rule.kind === 'group' && rule.items.length === 0) {
      issues.push({ severity: 'error', ruleId: rule.id, message: 'empty group' });
    }
  }

  visit(program.rules, program.sourceUrl);

  return issues;
}
