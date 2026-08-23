import { describe, it, expect, beforeAll } from 'vitest';
import { db } from '@/lib/db';
import { loadCourseDetail } from '@/lib/course-detail';

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
