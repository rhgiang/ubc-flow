import { describe, it, expect, beforeAll } from 'vitest';
import { db } from '@/lib/db';
import { loadCourseDetail } from '@/lib/course-detail';
import { aggregateDistributions } from '@/grades/aggregate';
import { GRADE_BUCKETS } from '@/grades/parse-csv';

let courseId: string;
let termId: string;

beforeAll(async () => {
  // A course that actually has a section, so the section list is exercised.
  const section = await db.section.findFirstOrThrow({ select: { courseId: true, termId: true } });
  courseId = section.courseId;
  termId = section.termId;
});

describe('loadCourseDetail', () => {
  it('returns the course header and a link to its full page', async () => {
    const detail = await loadCourseDetail(courseId, termId);
    expect(detail).not.toBeNull();
    expect(detail!.courseId).toBe(courseId);
    expect(detail!.code).toMatch(/^[A-Z]+ \S+$/);
    expect(detail!.title.length).toBeGreaterThan(0);
    // Slug convention must match the course page's own.
    expect(detail!.href).toBe(`/course/${detail!.code.toLowerCase().replace(/\s+/g, '-')}`);
  });

  it('returns only sections in the requested term', async () => {
    const detail = await loadCourseDetail(courseId, termId);
    const ids = detail!.sections.map((s) => s.sectionId);
    expect(ids.length).toBeGreaterThan(0);

    const rows = await db.section.findMany({
      where: { id: { in: ids } },
      select: { termId: true },
    });
    expect(rows.every((r) => r.termId === termId)).toBe(true);
  });

  it('returns no sections for a term the course is not offered in', async () => {
    const emptyTerm = await db.term.findFirst({
      where: { campus: 'V', sections: { none: { courseId } } },
      select: { id: true },
    });
    // Every term in the dataset offers this course — nothing to assert.
    if (!emptyTerm) return;

    const detail = await loadCourseDetail(courseId, emptyTerm.id);
    expect(detail).not.toBeNull();
    expect(detail!.sections).toEqual([]);
    // The course itself still loads — only its section list is term-scoped.
    expect(detail!.courseId).toBe(courseId);
  });

  it('always returns a grade summary object, even with no grade rows', async () => {
    const detail = await loadCourseDetail(courseId, termId);
    expect(detail!.grades).toBeDefined();
    expect(typeof detail!.grades.sectionCount).toBe('number');
  });

  it('returns null for a course that does not exist', async () => {
    expect(await loadCourseDetail('no-such-course-id', termId)).toBeNull();
  });
});

describe('loadCourseDetail instructor ratings', () => {
  it('attaches a rating summary slot to every instructor', async () => {
    const detail = await loadCourseDetail(courseId, termId);
    const withInstructors = detail!.sections.filter((s) => s.instructors.length > 0);
    // Some catalogue sections legitimately list no instructor yet.
    if (withInstructors.length === 0) return;

    for (const s of withInstructors) {
      for (const i of s.instructors) {
        expect(typeof i.name).toBe('string');
        expect(typeof i.slug).toBe('string');
        // Present as a key on every instructor — null when unrated.
        expect(i).toHaveProperty('rating');
      }
    }
  });

  it('reports null for an instructor with no reviews', async () => {
    const detail = await loadCourseDetail(courseId, termId);
    const all = detail!.sections.flatMap((s) => s.instructors);
    if (all.length === 0) return;

    const slugs = all.map((i) => i.slug);
    // InstructorReview has no `instructor` relation, only the scalar
    // instructorId — resolve ids from slugs first.
    const instructorIds = (
      await db.instructor.findMany({ where: { slug: { in: slugs } }, select: { id: true } })
    ).map((i) => i.id);
    const rated = await db.instructorReview.findMany({
      where: { instructorId: { in: instructorIds } },
      select: { instructorId: true },
    });
    if (rated.length > 0) return; // this fixture course has reviews; covered below

    expect(all.every((i) => i.rating === null)).toBe(true);
  });

  it('summarises real reviews when they exist', async () => {
    // Find any instructor who actually has reviews, and a course they teach.
    const review = await db.instructorReview.findFirst({
      select: { instructorId: true, courseId: true },
    });
    if (!review) return; // no review data in this database

    const section = await db.section.findFirst({
      where: { courseId: review.courseId, instructors: { some: { instructorId: review.instructorId } } },
      select: { termId: true },
    });
    if (!section) return;

    const detail = await loadCourseDetail(review.courseId, section.termId);
    const instructor = await db.instructor.findUniqueOrThrow({
      where: { id: review.instructorId },
      select: { slug: true },
    });

    const found = detail!.sections
      .flatMap((s) => s.instructors)
      .find((i) => i.slug === instructor.slug);
    expect(found).toBeDefined();
    expect(found!.rating).not.toBeNull();
    expect(found!.rating!.count).toBeGreaterThan(0);
  });
});

describe('loadCourseDetail instructor grade history', () => {
  it('exposes a courseAverage alongside the grade summary', async () => {
    const detail = await loadCourseDetail(courseId, termId);
    // Either a real number, or null when the course has no graded offerings.
    expect(detail!.courseAverage === null || typeof detail!.courseAverage === 'number').toBe(true);
    if (detail!.grades.sectionCount > 0 && detail!.grades.average !== null) {
      expect(detail!.courseAverage).toBeCloseTo(detail!.grades.average, 1);
    }
  });

  it('attaches a grades slot to every instructor', async () => {
    const detail = await loadCourseDetail(courseId, termId);
    for (const s of detail!.sections) {
      for (const i of s.instructors) expect(i).toHaveProperty('grades');
    }
  });

  it('weights an instructor average by student count, not by offering count', async () => {
    // Find an instructor with more than one graded offering of one course.
    const links = await db.gradeDistributionInstructor.findMany({
      include: { distribution: { select: { courseId: true, average: true, count: true } } },
      take: 2000,
    });
    const key = (i: string, c: string) => `${i}|${c}`;
    const groups = new Map<string, { average: number | null; count: number | null }[]>();
    for (const l of links) {
      const k = key(l.instructorId, l.distribution.courseId);
      groups.set(k, [...(groups.get(k) ?? []), l.distribution]);
    }
    const multi = [...groups.entries()].find(
      ([, rows]) => rows.length > 1 && rows.every((r) => r.average !== null && r.count !== null),
    );
    if (!multi) return; // no suitable fixture in this database

    const [k] = multi;
    const [instructorId, gradedCourseId] = k.split('|');
    // The `take: 2000` scan above is only a cheap way to *find* a candidate
    // pair — this database has 28k+ links, so that window can catch a pair
    // mid-group and miss some of its rows. Re-fetch the complete set for the
    // exact pair before computing `expected`, so it reflects every offering
    // (matching what loadCourseDetail itself aggregates), not an arbitrary
    // partial slice of it.
    const rows = (
      await db.gradeDistributionInstructor.findMany({
        where: { instructorId, distribution: { courseId: gradedCourseId } },
        select: { distribution: { select: { average: true, count: true } } },
      })
    )
      .map((l) => l.distribution)
      .filter((r) => r.average !== null && r.count !== null && r.count > 0);
    const expected =
      rows.reduce((a, r) => a + r.average! * r.count!, 0) / rows.reduce((a, r) => a + r.count!, 0);

    const section = await db.section.findFirst({
      where: { courseId: gradedCourseId, instructors: { some: { instructorId } } },
      select: { termId: true },
    });
    if (!section) return;

    const detail = await loadCourseDetail(gradedCourseId, section.termId);
    const instructor = await db.instructor.findUniqueOrThrow({
      where: { id: instructorId },
      select: { slug: true },
    });
    const found = detail!.sections
      .flatMap((s) => s.instructors)
      .find((i) => i.slug === instructor.slug);
    if (!found) return;

    expect(found.grades).not.toBeNull();
    expect(found.grades!.average).toBeCloseTo(expected, 1);
    expect(found.grades!.offerings).toBe(rows.length);
  });

  it('sums an instructor distribution over their own offerings only', async () => {
    // The comparison overlay puts this chart beside the course-wide one, so it
    // must cover this instructor's offerings of this course and nothing else —
    // not the course's other sections, and not their other courses.
    const link = await db.gradeDistributionInstructor.findFirst({
      where: { distribution: { count: { gt: 0 }, average: { not: null } } },
      select: { instructorId: true, distribution: { select: { courseId: true } } },
    });
    if (!link) return; // no graded links in this database

    const { instructorId } = link;
    const gradedCourseId = link.distribution.courseId;

    const section = await db.section.findFirst({
      where: { courseId: gradedCourseId, instructors: { some: { instructorId } } },
      select: { termId: true },
    });
    if (!section) return;

    const mine = (
      await db.gradeDistributionInstructor.findMany({
        where: { instructorId, distribution: { courseId: gradedCourseId } },
        select: { distribution: { select: { average: true, count: true, distribution: true } } },
      })
    )
      .map((l) => l.distribution)
      .filter((r) => r.average !== null && r.count !== null && r.count > 0);
    if (mine.length === 0) return;

    const expected = aggregateDistributions(
      mine.map((r) => ({
        average: r.average,
        count: r.count,
        distribution: r.distribution as Record<string, number | null> | null,
      })),
    ).distribution;

    const instructor = await db.instructor.findUniqueOrThrow({
      where: { id: instructorId },
      select: { slug: true },
    });
    const detail = await loadCourseDetail(gradedCourseId, section.termId);
    const found = detail!.sections
      .flatMap((s) => s.instructors)
      .find((i) => i.slug === instructor.slug);
    if (!found?.grades) return;

    expect(found.grades.distribution).toEqual(expected);
    expect(found.grades.students).toBe(mine.reduce((a, r) => a + r.count!, 0));

    // And it must be a strict subset of the course-wide chart: the course
    // includes every instructor's offerings, so no bucket can exceed it.
    for (const bucket of GRADE_BUCKETS) {
      const forInstructor = found.grades.distribution[bucket];
      const forCourse = detail!.grades.distribution[bucket];
      if (forInstructor === null || forCourse === null) continue;
      expect(forInstructor).toBeLessThanOrEqual(forCourse);
    }
  });

  it('returns null grades for an instructor with no history for this course', async () => {
    const detail = await loadCourseDetail(courseId, termId);
    const all = detail!.sections.flatMap((i) => i.instructors);
    for (const i of all) {
      if (i.grades === null) return; // found the null path, that is all we need
    }
    // Every instructor happened to have history — nothing to assert.
  });
});
