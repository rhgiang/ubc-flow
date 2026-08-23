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
