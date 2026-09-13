import { courseLevel, matches, type CourseRef, type CourseSet } from '@/guidance/rules';
import { treeMet } from '@/guidance/solver';
import type { Requirement } from '@/prereqs/parse';

/**
 * Real courses a student could put in an elective slot.
 *
 * A degree plan says "3 credits of Arts" or "9 credits of CPSC 300+" far more
 * often than it names a course - most of Winter Term 2 and nearly all of
 * third and fourth year for a CS major. Flow Builder could only arrange named
 * courses, so those terms came back with one course or none, which reads as a
 * broken tool rather than as a term that is mostly the student's own choice.
 *
 * The plan's own `examples` are unusable for this: they are the first three
 * catalogue rows that match, so "Arts credits" suggested ENGL 510A - a
 * graduate seminar - to an incoming first-year. These are filtered to what a
 * student could actually register for and sorted so the plausible ones lead.
 */
export type ElectiveCandidate = { id: string; code: string; credits: number };

export type SuggestInput = {
  /** The requirement's course set - what the slot will accept. */
  set: CourseSet;
  catalogue: CourseRef[];
  /** courseId -> term ids where it is actually offered. */
  offerings: Map<string, Set<string>>;
  termId: string;
  /** courseId -> parsed prerequisite tree. */
  prereqs: Map<string, Requirement | null>;
  /** Course ids the student will have finished before this term. */
  satisfied: Set<string>;
  /** Year of the degree, which caps how senior a suggestion may be. */
  year: number;
  /** Ids to leave out - already planned, or already suggested elsewhere. */
  exclude: Set<string>;
  /**
   * courseId -> how many students have taken it, summed from the grade
   * history. The difference between offering ENGL 110 (21,557 students) and
   * ENGL 229B (a seminar nobody outside the department has heard of).
   */
  popularity?: Map<string, number>;
  limit?: number;
};

/**
 * A first-year has no business being offered a 400-level seminar, and a
 * fourth-year does not want 100-level filler at the top of the list. One year
 * of stretch above the student's own, capped below graduate work.
 */
function levelCeiling(year: number): number {
  return Math.min(400, Math.max(100, year * 100 + 100));
}

export function suggestElectives(input: SuggestInput): ElectiveCandidate[] {
  const { set, catalogue, offerings, termId, prereqs, satisfied, year, exclude } = input;
  const ceiling = levelCeiling(year);

  const eligible = catalogue.filter((course) => {
    if (exclude.has(course.id)) return false;
    if (!matches(set, course)) return false;
    // Bands, not raw numbers: courseLevel('301') is 301, so comparing it
    // against a 300 ceiling would reject every 300-level course but x00.
    const band = Math.floor(courseLevel(course.number) / 100) * 100;
    // Graduate courses are never a suggestion, whatever the rule allows.
    if (band < 100 || band >= 500 || band > ceiling) return false;
    // Offered THIS term, or it cannot go in this schedule at all.
    if (!offerings.get(course.id)?.has(termId)) return false;
    // Prerequisites they will actually hold by then. A course whose prereq
    // tree is unparsed (null) passes, same rule the solver uses.
    return treeMet(prereqs.get(course.id), satisfied);
  });

  /*
    Ranked by how many students actually take the course, then spread across
    subjects.

    Sorting by level and code alone put eight ENGL courses at the top of
    "3 credits of Arts" - alphabetically first, and mostly seminars nobody
    takes. A student wants the courses their friends are in: ENGL 110, PSYC
    101, HIST 102. Enrolment history says which those are, and round-robining
    subjects stops one department owning the whole list.
  */
  const popularity = input.popularity ?? new Map<string, number>();
  const rank = (c: CourseRef) =>
    popularity.get(c.id) ?? 0;

  const bySubject = new Map<string, CourseRef[]>();
  for (const course of eligible) {
    const list = bySubject.get(course.subject);
    if (list) list.push(course);
    else bySubject.set(course.subject, [course]);
  }
  for (const list of bySubject.values()) {
    list.sort(
      (a, b) =>
        rank(b) - rank(a) ||
        courseLevel(b.number) - courseLevel(a.number) ||
        a.code.localeCompare(b.code),
    );
  }

  // Subjects ordered by their strongest course, then one from each in turn.
  const queues = [...bySubject.values()].sort((a, b) => rank(b[0]) - rank(a[0]));
  const out: CourseRef[] = [];
  const limit = input.limit ?? 8;
  for (let round = 0; out.length < limit; round += 1) {
    let added = false;
    for (const queue of queues) {
      const course = queue[round];
      if (!course) continue;
      out.push(course);
      added = true;
      if (out.length >= limit) break;
    }
    if (!added) break;
  }

  return out.map((c) => ({ id: c.id, code: c.code, credits: c.credits }));
}
