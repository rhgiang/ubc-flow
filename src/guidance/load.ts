import "server-only";
import { db } from "@/lib/db";
import { unstable_cache } from "next/cache";
import type { CourseRef } from "@/guidance/rules";
import type { Completion } from "@/guidance/progress";
import { type PlanTerm, tightenNotes } from "@/guidance/solver";
import type { Requirement } from "@/prereqs/parse";
import { isUpcomingTerm, compareTerms } from "@/schedule/terms";

/**
 * Everything the guidance engine needs out of the database, in its own shapes.
 * The engine itself stays free of Prisma types so it can be tested without one.
 */

/**
 * The campus-wide reads below are cached on the same terms as the explore and
 * course pages: a day, busted early by review writes. None of it is per-user,
 * and before this every /guidance hit ran all four queries against Neon and
 * then the solver: the most expensive request in the app, and crawlable.
 *
 * Only raw rows go in the cache. unstable_cache serialises through JSON, which
 * turns a Map or a Set into `{}`, so the shapes the solver wants are built
 * outside it on every call. That is cheap; the database round trip was the
 * cost. Argument lists are sorted so a key does not depend on the order a
 * rule set happened to mention things in.
 */
const CATALOGUE_CACHE = { revalidate: 86400, tags: ["catalogue"] };

const cachedCourseRows = unstable_cache(
  (subjects: string[]) =>
    db.course.findMany({
      where: { campus: "V", subject: { code: { in: subjects } } },
      select: {
        id: true,
        number: true,
        credits: true,
        subject: { select: { code: true, faculty: true } },
      },
    }),
  ["guidance-catalogue"],
  CATALOGUE_CACHE,
);

const cachedPrereqRows = unstable_cache(
  (ids: string[]) =>
    db.course.findMany({
      where: { id: { in: ids } },
      select: { id: true, prereqTree: true },
    }),
  ["guidance-prereqs"],
  CATALOGUE_CACHE,
);

const cachedSectionTerms = unstable_cache(
  (courseIds: string[]) =>
    db.section.findMany({
      where: { courseId: { in: courseIds } },
      select: { courseId: true, termId: true },
      distinct: ["courseId", "termId"],
    }),
  ["guidance-offerings"],
  CATALOGUE_CACHE,
);

const cachedTermRows = unstable_cache(
  () =>
    db.term.findMany({
      where: { campus: "V" },
      // Only what the ordinal helpers and the labels read. Term also carries
      // two DateTime columns, and a Date does not survive the JSON round trip.
      select: { id: true, name: true, year: true, session: true, termNumber: true },
    }),
  ["guidance-terms"],
  CATALOGUE_CACHE,
);

/** The subjects a program can draw on. Loading all 7,336 courses to plan one
 *  degree is waste, so callers pass the subjects their rules actually mention. */
export async function loadCatalogue(subjects: string[]): Promise<CourseRef[]> {
  const rows = await cachedCourseRows([...subjects].sort());
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
export async function loadPrereqs(
  catalogue: CourseRef[],
): Promise<Map<string, Requirement | null>> {
  const rows = await cachedPrereqRows(catalogue.map((c) => c.id).sort());
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
export async function loadOfferings(
  courseIds: string[],
): Promise<Map<string, Set<string>>> {
  const sections = await cachedSectionTerms([...courseIds].sort());
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
// Seven years of projection, not five. Five covers a four-year degree at any
// sensible load, but not a 158-credit B.A.Sc. at 12 credits a term: that needs
// thirteen WINTER terms and five years of projection only yields twelve, so
// the plan reported the last of Civil as unplaceable when the real limit was
// how far ahead we had bothered to look. Projected terms cost nothing — the
// solver stops as soon as the degree is done.
export async function loadTerms(years = 7): Promise<PlanTerm[]> {
  const terms = await cachedTermRows();
  const real = terms
    .filter(isUpcomingTerm)
    .sort(compareTerms)
    .map((t) => ({
      id: t.id,
      name: t.name.replace(" (UBC-V)", ""),
      // Always true today. Co-op work terms are the reason this is data:
      // marking a term unavailable must not require touching the solver.
      available: true,
    }));

  // Continue from the last real Winter session we know about.
  const lastYear = Math.max(
    ...terms.map((t) => t.year),
    new Date().getFullYear(),
  );
  const projected: PlanTerm[] = [];
  for (let i = 0; i < years; i++) {
    const start = lastYear + i;
    projected.push(
      {
        id: `p-${start}S`,
        name: `${start + 1} Summer Session`,
        available: true,
        projected: true,
      },
      {
        id: `p-${start + 1}W1`,
        name: `${start + 1}-${String(start + 2).slice(2)} Winter Term 1`,
        available: true,
        projected: true,
      },
      {
        id: `p-${start + 1}W2`,
        name: `${start + 1}-${String(start + 2).slice(2)} Winter Term 2`,
        available: true,
        projected: true,
      },
    );
  }
  return [...real, ...projected];
}

/**
 * What a student has actually done, for checking a degree against a person
 * rather than against a plan.
 *
 * Read from `Enrollment.status`, which the Workday import now derives from the
 * grade Workday reports. A row whose grade we could not read stays
 * "registered" and counts as in progress rather than done — guessing in the
 * permissive direction is how a student gets told they finished a course they
 * have to retake.
 *
 * Rows written before the grade column existed default to "registered" too,
 * so an old import understates progress until it is uploaded again. That is
 * the safe direction, and the page says which rows are which.
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
      select: { courseId: true, termId: true, source: true, status: true },
    }),
    // Kept for the in-progress distinction only. Term.startDate and endDate
    // are null on every row the scraper writes, so this uses the ordinal
    // comparison isUpcomingTerm already does rather than a date.
    db.term.findMany({
      select: { id: true, year: true, session: true, termNumber: true },
    }),
  ]);

  // No early return on an empty enrollment list. A student who transferred in
  // has no enrollments at all, and returning here skipped the transfer credits
  // below — which is precisely the person this is meant to help.
  const courses = rows.length
    ? await db.course.findMany({
        where: { id: { in: [...new Set(rows.map((r) => r.courseId))] } },
        select: {
          id: true,
          number: true,
          credits: true,
          subject: { select: { code: true, faculty: true } },
        },
      })
    : [];
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

    // The import's own verdict, not a guess. "registered" means the grade was
    // blank or unreadable, which is in progress if the term is still running
    // and unknown if it is not — either way not something to count as done.
    const status: Completion["status"] =
      row.status === "transfer"
        ? "transfer"
        : row.status === "passed"
          ? "passed"
          : row.status === "failed"
            ? "failed"
            : // Both arms of the old term-based branch here returned
              // "in_progress", so the lookup decided nothing; it only became
              // visible when termId went nullable for academic-record rows.
              "in_progress";

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

  // Credit earned elsewhere counts toward the degree. Only the rows that
  // resolved to a real UBC course can satisfy a NAMED requirement; unassigned
  // credit like "PHYS_V 1ST" is real credit against the total but matches no
  // rule, so it is left out here rather than attached to a course it is not.
  const transfers = await db.transferCredit.findMany({
    where: { userId, courseId: { not: null } },
    select: {
      credits: true,
      course: {
        select: {
          id: true,
          number: true,
          credits: true,
          subject: { select: { code: true, faculty: true } },
        },
      },
    },
  });
  for (const t of transfers) {
    const c = t.course;
    if (!c || !c.subject.code || seen.has(c.id)) continue;
    seen.add(c.id);
    out.push({
      status: "transfer",
      course: {
        id: c.id,
        subject: c.subject.code,
        number: c.number,
        code: `${c.subject.code} ${c.number}`,
        // Falls through on zero as well as null. A transfer row exists
        // because credit was granted, so an empty Credits cell is missing
        // data rather than a grant of nothing — APSC 160 arrived as 0 and
        // would have shown as a 0-credit course a student had "done".
        credits: t.credits || c.credits || 3,
        faculty: c.subject.faculty,
      },
    });
  }
  return out;
}
