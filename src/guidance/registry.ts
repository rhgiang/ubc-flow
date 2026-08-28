import { withYears, type Program, type Rule } from '@/guidance/rules';
import { biocMajor2026W } from '@/guidance/programs/bioc-major-2026w';
import { biolMajor2026W } from '@/guidance/programs/biol-major-2026w';
import { cpscMajor2026W } from '@/guidance/programs/cpsc-major-2026w';
import { scienceFacultyCore2026W } from '@/guidance/programs/science-faculty-core-2026w';
import { mathMajor2026W } from '@/guidance/programs/math-major-2026w';
import { micbMajor2026W } from '@/guidance/programs/micb-major-2026w';
import { physMajor2026W } from '@/guidance/programs/phys-major-2026w';
import { statMajor2026W } from '@/guidance/programs/stat-major-2026w';

/**
 * Every program the guidance engine knows about.
 *
 * The checked-in files are the source of truth: a requirement change should
 * arrive as a reviewable diff, not a silent row update. Seeding these into the
 * Program table is what makes cross-program queries possible later; nothing in
 * the current page needs it, so it does not exist yet.
 */
const PROGRAMS: Program[] = [
  scienceFacultyCore2026W,
  biocMajor2026W,
  biolMajor2026W,
  cpscMajor2026W,
  mathMajor2026W,
  micbMajor2026W,
  physMajor2026W,
  statMajor2026W,
];

/** Programs a student can pick — faculty cores are building blocks, not choices. */
export const selectable = PROGRAMS.filter((p) => p.extends.length > 0 || p.code.includes('major'));

export function getProgram(code: string): Program | null {
  return PROGRAMS.find((p) => p.code === code) ?? null;
}

/**
 * A program's own rules with everything it extends merged in ahead of them.
 *
 * Faculty rules come first so that the per-major requirements are evaluated
 * against a student's courses only after the faculty-wide ones have taken
 * what they need — the progress engine spends each course once, and a broad
 * "12 credits of Arts" bucket must not swallow a course a named major
 * requirement was going to use.
 */
export function effectiveRules(program: Program, seen: Set<string> = new Set()): Rule[] {
  if (seen.has(program.code)) return []; // guard against a cyclic extends chain
  seen.add(program.code);
  const inherited = program.extends.flatMap((code) => {
    const parent = getProgram(code);
    return parent ? effectiveRules(parent, seen) : [];
  });
  // Years are declared on the year groups; push them down so every rule
  // carries its own and the solver can read one without its parent.
  return [...inherited, ...withYears(program.rules)];
}
