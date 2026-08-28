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

  walk(program.rules, (rule) => {
    if (seen.has(rule.id)) {
      // Progress keys off rule id; a duplicate makes one rule silently
      // shadow the other and under-report what a student still owes.
      issues.push({ severity: 'error', ruleId: rule.id, message: 'duplicate rule id' });
    }
    seen.add(rule.id);

    if (!rule.label.trim()) {
      issues.push({ severity: 'error', ruleId: rule.id, message: 'empty label' });
    }
    if (!rule.sourceUrl) {
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
      if (setIsEmpty(rule.from)) {
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
  });

  return issues;
}
