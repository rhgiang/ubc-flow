import 'server-only';
import { db } from '@/lib/db';
import type { CourseRef } from '@/guidance/rules';
import type { Completion } from '@/guidance/progress';
import { type PlanTerm, tightenNotes } from '@/guidance/solver';
import type { Requirement } from '@/prereqs/parse';
import { isUpcomingTerm, compareTerms } from '@/schedule/terms';

/**
 * Everything the guidance engine needs out of the database, in its own shapes.
 * The engine itself stays free of Prisma types so it can be tested without one.
 */

/** The subjects a program can draw on. Loading all 7,336 courses to plan one
 *  degree is waste, so callers pass the subjects their rules actually mention. */
export async function loadCatalogue(subjects: string[]): Promise<CourseRef[]> {
  const rows = await db.course.findMany({
    where: { campus: 'V', subject: { code: { in: subjects } } },
    select: {
      id: true,
      number: true,
      credits: true,
      subject: { select: { code: true, faculty: true } },
    },
  });
  return rows
    .filter((r) => r.subject.code)
    .map((r) => ({
      id: r.id,
      subject: r.subject.code as string,
      number: r.number,
      code: `${r.subject.code} ${r.number}`,
      credits: r.credits ?? 3,
      faculty: r.subject.faculty,
    }));
}

/**
 * courseId -> its parsed prerequisite tree.
 *
 * Deliberately NOT CoursePrereqEdge. That table flattens the tree, so
 * CPSC 210's "One of CPSC 107, CPSC 110" becomes two edges; anything that
 * requires all of them demands a pair no student takes, which made most of a
 * CS degree unplaceable. The tree keeps the or.
 */
export async function loadPrereqs(catalogue: CourseRef[]): Promise<Map<string, Requirement | null>> {
  const rows = await db.course.findMany({
    where: { id: { in: catalogue.map((c) => c.id) } },
    select: { id: true, prereqTree: true },
  });
  // Codes the loaded catalogue can resolve. A prereq naming a subject outside
  // the program (DSCI, CPEN) resolves to nothing and drops out of a tightened
  // note, which is what keeps that heuristic from over-blocking.
  const codeToId = new Map(catalogue.map((c) => [c.code, c.id]));
  const map = new Map<string, Requirement | null>();
  for (const r of rows) {
    map.set(r.id, tightenNotes(r.prereqTree as Requirement | null, codeToId));
  }
  return map;
}

/**
 * courseId -> term ids where it actually runs.
 *
 * A course with no sections at all gets no entry, and the solver treats an
 * absent entry as "no information" rather than "never offered" — most of the
 * catalogue has no future sections loaded, and refusing to plan those would
 * empty the roadmap.
 */
export async function loadOfferings(courseIds: string[]): Promise<Map<string, Set<string>>> {
  const sections = await db.section.findMany({
    where: { courseId: { in: courseIds } },
    select: { courseId: true, termId: true },
    distinct: ['courseId', 'termId'],
  });
  const map = new Map<string, Set<string>>();
  for (const s of sections) {
    const set = map.get(s.courseId) ?? new Set<string>();
    set.add(s.termId);
    map.set(s.courseId, set);
  }
  return map;
}

/**
 * Placeable terms, in order: the real upcoming ones, then projected terms to
 * cover the rest of a degree.
 *
 * UBC publishes sections about a year ahead — the database holds five terms
 * total. A degree takes four years, so without projection the roadmap stops
 * partway through second year and reports the remaining two-thirds of the
 * program as unplaceable, which is what it did before this existed.
 */
export async function loadTerms(years = 5): Promise<PlanTerm[]> {
  const terms = await db.term.findMany({ where: { campus: 'V' } });
  const real = terms
    .filter(isUpcomingTerm)
    .sort(compareTerms)
    .map((t) => ({
      id: t.id,
      name: t.name.replace(' (UBC-V)', ''),
      // Always true today. Co-op work terms are the reason this is data:
      // marking a term unavailable must not require touching the solver.
      available: true,
    }));

  // Continue from the last real Winter session we know about.
  const lastYear = Math.max(...terms.map((t) => t.year), new Date().getFullYear());
  const projected: PlanTerm[] = [];
  for (let i = 0; i < years; i++) {
    const start = lastYear + i;
    projected.push(
      { id: `p-${start}S`, name: `${start + 1} Summer Session`, available: true, projected: true },
      { id: `p-${start + 1}W1`, name: `${start + 1}-${String(start + 2).slice(2)} Winter Term 1`, available: true, projected: true },
      { id: `p-${start + 1}W2`, name: `${start + 1}-${String(start + 2).slice(2)} Winter Term 2`, available: true, projected: true },
    );
  }
  return [...real, ...projected];
}

/**
 * What a student has actually done, for checking a degree against a person
 * rather than against a plan.
 *
 * This is the seam real grades will plug into. Right now `Enrollment` carries
 * no grade and no status — it is `{userId, courseId, termId, source,
 * verified}`, a record of REGISTRATION — so completion has to be inferred from
 * whether the term has finished, and that inference is wrong for anyone who
 * failed or withdrew. The page says so rather than hiding it; when
 * `Enrollment.grade` and `.status` land, this function changes and nothing
 * above it does.
 *
 * Transfer credit is reported as `transfer` rather than `passed`. UBC grants
 * the credit, so a roadmap that ignored it would overstate what a student
 * still owes — but it is earned elsewhere and must never confer review rights
 * for UBC's version of the course, which `canReview` enforces separately on
 * `verified`.
 */
export async function loadCompletions(userId: string): Promise<Completion[]> {
  const [rows, terms] = await Promise.all([
    db.enrollment.findMany({
      where: { userId },
      select: { courseId: true, termId: true, source: true },
    }),
    // year/session/termNumber, not the dates: Term.startDate and endDate are
    // null for every row the scraper writes, so a date comparison here would
    // silently mark every course as still in progress and count nothing.
    db.term.findMany({ select: { id: true, year: true, session: true, termNumber: true } }),
  ]);
  if (rows.length === 0) return [];

  const finished = new Map(terms.map((t) => [t.id, !isUpcomingTerm(t)]));
  const courses = await db.course.findMany({
    where: { id: { in: [...new Set(rows.map((r) => r.courseId))] } },
    select: {
      id: true,
      number: true,
      credits: true,
      subject: { select: { code: true, faculty: true } },
    },
  });
  const byId = new Map(courses.map((c) => [c.id, c]));

  const out: Completion[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const c = byId.get(row.courseId);
    if (!c || !c.subject.code) continue;
    // One row per course: a repeated course should not count twice toward a
    // credit requirement.
    if (seen.has(c.id)) continue;
    seen.add(c.id);

    const status: Completion['status'] =
      row.source === 'transfer'
        ? 'transfer'
        : finished.get(row.termId)
          ? 'passed'
          : 'in_progress';

    out.push({
      status,
      course: {
        id: c.id,
        subject: c.subject.code,
        number: c.number,
        code: `${c.subject.code} ${c.number}`,
        credits: c.credits ?? 3,
        faculty: c.subject.faculty,
      },
    });
  }
  return out;
}
