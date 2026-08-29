import { withYears, type Program, type Rule } from '@/guidance/rules';
import { apscCore2026W } from '@/guidance/programs/apsc-core-2026w';
import {
  chbeMajor2026W,
  civlMajor2026W,
  cpenMajor2026W,
  elecMajor2026W,
  mechMajor2026W,
} from '@/guidance/programs/apsc-majors-2026w';
import { artsFacultyCore2026W } from '@/guidance/programs/arts-faculty-core-2026w';
import { biocMajor2026W } from '@/guidance/programs/bioc-major-2026w';
import { biolMajor2026W } from '@/guidance/programs/biol-major-2026w';
import { capsMajor2026W } from '@/guidance/programs/caps-major-2026w';
import { chemMajor2026W } from '@/guidance/programs/chem-major-2026w';
import {
  commAccounting2026W,
  commFinance2026W,
  commGeneral2026W,
  commMarketing2026W,
} from '@/guidance/programs/comm-options-2026w';
import { commerceCore2026W } from '@/guidance/programs/commerce-core-2026w';
import { cpscMajor2026W } from '@/guidance/programs/cpsc-major-2026w';
import { scienceFacultyCore2026W } from '@/guidance/programs/science-faculty-core-2026w';
import { econMajor2026W } from '@/guidance/programs/econ-major-2026w';
import { englMajor2026W } from '@/guidance/programs/engl-major-2026w';
import { eoscMajor2026W } from '@/guidance/programs/eosc-major-2026w';
import { histMajor2026W } from '@/guidance/programs/hist-major-2026w';
import { mathMajor2026W } from '@/guidance/programs/math-major-2026w';
import { micbMajor2026W } from '@/guidance/programs/micb-major-2026w';
import { philMajor2026W } from '@/guidance/programs/phil-major-2026w';
import { physMajor2026W } from '@/guidance/programs/phys-major-2026w';
import { poliMajor2026W } from '@/guidance/programs/poli-major-2026w';
import { psycMajor2026W } from '@/guidance/programs/psyc-major-2026w';
import { sociMajor2026W } from '@/guidance/programs/soci-major-2026w';
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
  apscCore2026W,
  artsFacultyCore2026W,
  commerceCore2026W,
  scienceFacultyCore2026W,
  capsMajor2026W,
  chbeMajor2026W,
  civlMajor2026W,
  cpenMajor2026W,
  elecMajor2026W,
  mechMajor2026W,
  biocMajor2026W,
  biolMajor2026W,
  chemMajor2026W,
  commAccounting2026W,
  commFinance2026W,
  commGeneral2026W,
  commMarketing2026W,
  cpscMajor2026W,
  econMajor2026W,
  englMajor2026W,
  eoscMajor2026W,
  histMajor2026W,
  mathMajor2026W,
  micbMajor2026W,
  philMajor2026W,
  physMajor2026W,
  poliMajor2026W,
  psycMajor2026W,
  sociMajor2026W,
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

/**
 * The credit load a program runs at, used when the student has not picked one.
 *
 * Fifteen credits is a standard term for a 120-credit degree — 30 a year, 120
 * over four years. Engineering is not that degree. A B.A.Sc. runs 148 to 158
 * credits, and at 15 a term it renders as a five-and-a-half-year plan when the
 * Calendar itself calls it four Winter Sessions at full credit load.
 *
 * Full engineering load is 22. Not the degree average, which is 19 to 20 and
 * leaves every program spilling into a ninth term: a year's courses cannot
 * start early, and the two terms inside a year are uneven. Chemical and
 * Biological's third year is 40 credits, but the Department splits it 19 and
 * 21, so sizing to the even half strands the remainder. All four B.A.Sc.
 * programs fit eight terms at 22 and none of them do at 21.
 *
 * Applied only to oversized degrees, because a 120-credit program already
 * fits comfortably at 15 and has no reason to be rushed. It used to be capped
 * for a worse reason as well — above 21 the solver deadlocked and Statistics
 * returned a three-term plan with half the degree unplaced — but that was a
 * bug in how the current year was counted and is fixed; the cap is now just
 * the honest ceiling on what a student takes.
 *
 * Lives here rather than in the page because it is a fact about the program,
 * and the landing page quotes it beside each one.
 */
export function fullLoadFor(program: Program): number {
  const total = program.totalCredits;
  return total > 130 ? 22 : Math.max(15, Math.ceil(total / 8));
}

/**
 * Selectable programs grouped by credential, in the order the landing page
 * lists them. Degree maps one-to-one onto faculty today, so the faculty rides
 * along as the group's subtitle rather than being a second axis.
 */
export function byDegree(): { degree: string; faculty: string; programs: Program[] }[] {
  const order = ['BASc', 'BSc', 'BCom', 'BA'];
  /** An unlisted degree sorts last rather than first, which -1 would do. */
  const rank = (d: string) => (order.indexOf(d) === -1 ? order.length : order.indexOf(d));
  const groups = new Map<string, Program[]>();
  for (const p of selectable) {
    const list = groups.get(p.degree);
    if (list) list.push(p);
    else groups.set(p.degree, [p]);
  }
  return [...groups.entries()]
    .sort((a, b) => rank(a[0]) - rank(b[0]))
    .map(([degree, programs]) => ({
      degree,
      faculty: programs[0].faculty,
      programs: [...programs].sort((a, b) => a.name.localeCompare(b.name)),
    }));
}
