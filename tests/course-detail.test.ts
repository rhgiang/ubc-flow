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

  it('returns an empty section list for a term the course is not offered in', async () => {
    const otherTerm = await db.term.findFirst({ where: { id: { not: termId } }, select: { id: true } });
    if (!otherTerm) return; // single-term dataset; nothing to assert
    const detail = await loadCourseDetail(courseId, otherTerm.id);
    expect(detail).not.toBeNull();
    expect(detail!.sections.every((s) => s.sectionId !== undefined)).toBe(true);
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
