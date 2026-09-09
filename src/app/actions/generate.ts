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
};

const MAX_COURSES = 12;

export async function generationData(
  termId: string,
  courseIds: string[],
): Promise<GenerationData> {
  const ids = [...new Set(courseIds)].slice(0, MAX_COURSES);
  if (ids.length === 0) return { sections: [], profScores: {} };

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

  return { sections: rows.map(toSectionHit), profScores };
}
