'use server';

import { db } from '@/lib/db';
import { toSectionHit, sectionHitInclude, type SectionHit } from '@/lib/search';

/**
 * Everything the client-side schedule generator needs, in one round trip:
 * every section the chosen courses offer this term, and a 0..1 instructor
 * quality signal per section where one can be computed.
 *
 * Read-only over public catalogue data, so no auth — the generator works for
 * guests exactly like search and the companion check do. The search itself
 * runs in the browser; this endpoint only hands over data.
 *
 * The instructor signal prefers reviews (clear + engaging, the two things
 * students rate teaching on) and falls back to the instructor's grade history
 * in this course. A section with neither gets null, which the generator
 * scores as absence — never as bad.
 */
export type GenerationData = {
  sections: SectionHit[];
  profScores: Record<string, number | null>;
  /**
   * Courses asked for that field no sections this term at all.
   *
   * They used to disappear without a word — the generator only ever sees the
   * sections, so a course with none simply wasn't in the pool, and a plan of
   * five courses could quietly arrange four. Naming them is the difference
   * between "this tool is broken" and "MATH 103 isn't offered this term".
   */
  missing: { id: string; code: string }[];
};

const MAX_COURSES = 12;

export async function generationData(
  termId: string,
  courseIds: string[],
): Promise<GenerationData> {
  const ids = [...new Set(courseIds)].slice(0, MAX_COURSES);
  if (ids.length === 0) return { sections: [], profScores: {}, missing: [] };

  const rows = await db.section.findMany({
    where: { termId, courseId: { in: ids } },
    include: {
      ...sectionHitInclude,
      // The instructor RELATION (with ids) — toSectionHit keeps only names,
      // and the signals below are keyed by instructor id.
    },
    orderBy: [{ course: { number: 'asc' } }, { sectionCode: 'asc' }],
  });

  const instructorIds = [
    ...new Set(rows.flatMap((s) => s.instructors.map((si) => si.instructor.id))),
  ];

  const [reviews, distributions] = await Promise.all([
    instructorIds.length
      ? db.instructorReview.findMany({
          where: { instructorId: { in: instructorIds } },
          select: { instructorId: true, clear: true, engaging: true },
        })
      : [],
    // Grade history for these courses, joined to who taught the offering.
    db.gradeDistribution.findMany({
      where: { courseId: { in: ids }, average: { not: null } },
      select: { courseId: true, average: true, instructors: { select: { instructorId: true } } },
    }),
  ]);

  // Review signal: mean of clear+engaging across an instructor's reviews,
  // stored 0..4, normalised to 0..1.
  const reviewSums = new Map<string, { total: number; n: number }>();
  for (const r of reviews) {
    for (const v of [r.clear, r.engaging]) {
      if (v === null) continue;
      const s = reviewSums.get(r.instructorId) ?? { total: 0, n: 0 };
      s.total += v / 4;
      s.n += 1;
      reviewSums.set(r.instructorId, s);
    }
  }

  // Grade signal per (course, instructor): mean section average, mapped so
  // 60% is 0 and 85%+ is 1 — roughly the observed spread of UBC averages.
  const gradeSums = new Map<string, { total: number; n: number }>();
  for (const d of distributions) {
    for (const { instructorId } of d.instructors) {
      const key = `${d.courseId}|${instructorId}`;
      const s = gradeSums.get(key) ?? { total: 0, n: 0 };
      s.total += d.average!;
      s.n += 1;
      gradeSums.set(key, s);
    }
  }

  const profScores: Record<string, number | null> = {};
  for (const s of rows) {
    const signals: number[] = [];
    for (const si of s.instructors) {
      const reviewed = reviewSums.get(si.instructor.id);
      if (reviewed?.n) {
        signals.push(reviewed.total / reviewed.n);
        continue;
      }
      const graded = gradeSums.get(`${s.courseId}|${si.instructor.id}`);
      if (graded?.n) {
        const avg = graded.total / graded.n;
        signals.push(Math.min(1, Math.max(0, (avg - 60) / 25)));
      }
    }
    profScores[s.id] = signals.length
      ? signals.reduce((a, b) => a + b, 0) / signals.length
      : null;
  }

  // Only queried when something really is missing, which is the rare case.
  const found = new Set(rows.map((s) => s.courseId));
  const absent = ids.filter((id) => !found.has(id));
  const missing = absent.length
    ? (
        await db.course.findMany({
          where: { id: { in: absent } },
          select: { id: true, number: true, subject: { select: { code: true } } },
        })
      ).map((c) => ({ id: c.id, code: `${c.subject.code} ${c.number}` }))
    : [];

  return { sections: rows.map(toSectionHit), profScores, missing };
}

/**
 * The intake half of Flow Builder: a student with an empty builder tells us
 * their program (and co-op pattern) and gets the courses guidance's plan puts
 * in the builder's term — the exact list the guidance page's "Arrange this
 * term" button would have carried, without making them find that page first.
 *
 * Signed in with a record uploaded, the plan starts from what they've
 * completed (same as guidance); signed out or nothing uploaded, it plans the
 * degree from a standing start, which is right for the first-year this
 * intake mostly serves.
 */
export type ProgramOption = { code: string; name: string };
export type ProgramGroup = { degree: string; faculty: string; programs: ProgramOption[] };
export type CoopOption = { id: string; label: string };

export async function intakeOptions(): Promise<{
  programs: ProgramGroup[];
  coops: CoopOption[];
}> {
  const { byDegree } = await import('@/guidance/registry');
  const { COOP_PATTERNS } = await import('@/guidance/coop');
  return {
    programs: byDegree().map((g) => ({
      degree: g.degree,
      faculty: g.faculty,
      programs: g.programs.map((p) => ({ code: p.code, name: p.name })),
    })),
    coops: COOP_PATTERNS.map((p) => ({ id: p.id, label: p.label })),
  };
}

export type PlannedTermCourses = {
  /** Concrete courses the plan places in this term. */
  courses: { id: string; code: string }[];
  /**
   * Requirements this term fills with an amount rather than a named course —
   * "3 credits of Arts". They cannot be auto-arranged (choosing one IS the
   * student's decision), but they must be VISIBLE: a plan that quietly hands
   * over one course when the term is really five reads as broken.
   */
  slots: { label: string; credits: number; examples: string[] }[];
  /** False when the plan puts no coursework in this term at all. */
  planned: boolean;
  /** Set when the term is a co-op work term under the chosen pattern. */
  workTerm: boolean;
};

export type IntakeAnswers = {
  /** Year of the degree they'll be in — 1 for an incoming first-year. */
  year: number;
  /** Credits to plan for the term; null takes the program's own full load. */
  creditsPerTerm: number | null;
};

/** "…Winter Term 1 (UBC-V)" → 'T1'. The slot, not the calendar year. */
function slotOf(name: string): 'T1' | 'T2' | 'summer' {
  if (/winter term 2/i.test(name)) return 'T2';
  if (/summer/i.test(name)) return 'summer';
  return 'T1';
}

export async function plannedCoursesForTerm(
  programCode: string,
  coopId: string | null,
  termId: string,
  answers: IntakeAnswers = { year: 1, creditsPerTerm: null },
): Promise<PlannedTermCourses | { error: string }> {
  // Guidance's own pipeline, imported lazily so the plain generationData call
  // never pays for the solver.
  const [{ getProgram, effectiveRules, fullLoadFor }, coopMod, load, progressMod, { solve }] =
    await Promise.all([
      import('@/guidance/registry'),
      import('@/guidance/coop'),
      import('@/guidance/load'),
      import('@/guidance/progress'),
      import('@/guidance/solver'),
    ]);
  const { getCoopPattern, applyCoop, degreeYears, fromFirstWinter, workTermIds } = coopMod;
  const { loadCatalogue, loadCompletions, loadOfferings, loadPrereqs, loadTerms } = load;
  const { outstanding } = progressMod;

  const program = getProgram(programCode);
  if (!program) return { error: 'Pick a program first.' };
  const coop = getCoopPattern(coopId ?? undefined);

  const rules = effectiveRules(program);
  const subjects = new Set<string>();
  const { walk } = await import('@/guidance/rules');
  walk(rules, (r) => {
    if (r.kind === 'course') subjects.add(r.code.split(' ')[0]);
    if (r.kind === 'credits' && r.from.kind === 'pattern')
      r.from.subjects?.forEach((s) => subjects.add(s));
    if (r.kind === 'credits' && r.from.kind === 'codes')
      r.from.codes.forEach((c) => subjects.add(c.split(' ')[0]));
  });

  const [catalogue, allTerms] = await Promise.all([loadCatalogue([...subjects]), loadTerms()]);
  const terms = applyCoop(fromFirstWinter(allTerms), coop);
  const work = workTermIds(allTerms, coop);
  if (work.has(termId)) {
    return { courses: [], slots: [], planned: false, workTerm: true };
  }

  const ids = catalogue.map((c) => c.id);
  const [prereqs, offerings] = await Promise.all([loadPrereqs(catalogue), loadOfferings(ids)]);

  const { auth } = await import('@/lib/auth');
  const session = await auth().catch(() => null);
  const userId = session?.user?.id ?? null;
  const completions = userId ? await loadCompletions(userId) : [];
  const done = completions.filter((c) => c.status === 'passed' || c.status === 'transfer');

  const plan = solve({
    outstanding: outstanding(completions, rules),
    completed: done.map((c) => c.course),
    catalogue,
    prereqs,
    offerings,
    terms,
    // Co-op runs year-round, same reasoning as the guidance page.
    prefs: {
      creditsPerTerm: Math.min(24, Math.max(3, answers.creditsPerTerm || fullLoadFor(program))),
      useSummer: coop !== null,
      targetTermId: null,
    },
  });

  /*
    Which planned term to hand over.

    NOT the one whose id matches: the plan always starts from the next Winter
    session, so its first terms are first-year courses. A third-year student
    asking to build THIS term wants their third year's courses, and matching
    by id gave them a first-year's — usually a nearly-empty term, since much
    of first year is elective slots. So match by position instead: the term at
    the student's year of the degree, in the same slot (Winter 1, Winter 2 or
    summer) as the one the builder is on.

    A student who has uploaded their record needs none of this — the solver
    already knows what they've finished — but the year answer is what makes
    the intake work for everyone else, which is nearly everyone.
  */
  const years = degreeYears(terms);
  const targetSlot = slotOf(allTerms.find((t) => t.id === termId)?.name ?? '');
  const wantYear = Math.max(1, Math.min(8, answers.year));
  const byYear = plan.terms.find(
    (t) => years.get(t.term.id) === wantYear && slotOf(t.term.name) === targetSlot,
  );
  const byCalendar = plan.terms.find((t) => t.term.id === termId);
  // An uploaded record beats the year answer, and by a lot: the solver has
  // already subtracted everything they finished, so its first terms ARE their
  // next ones. Letting "3rd year" win there would have handed a third-year
  // student courses two years past where they actually are.
  const planned = done.length > 0 ? (byCalendar ?? byYear) : (byYear ?? byCalendar);

  if (!planned) return { courses: [], slots: [], planned: false, workTerm: false };
  return {
    courses: planned.placements.flatMap((pl) =>
      pl.kind === 'course' ? [{ id: pl.course.id, code: pl.course.code }] : [],
    ),
    slots: planned.placements.flatMap((pl) =>
      pl.kind === 'slot'
        ? [
            {
              label: pl.label,
              credits: pl.credits,
              examples: pl.examples.slice(0, 3).map((e) => e.code),
            },
          ]
        : [],
    ),
    planned: true,
    workTerm: false,
  };
}
