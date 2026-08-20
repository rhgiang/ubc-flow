import { db } from '@/lib/db';
import type { Prisma } from '@prisma/client';

export type CourseHit = { code: string; title: string; subjectName: string };

/** "cpsc 221" -> code+number match; "cpsc" -> code; anything else -> title. */
export function buildSearchWhere(query: string): Prisma.CourseWhereInput {
  const q = query.trim();
  if (!q) return {};

  const codeAndNumber = q.match(/^([a-z]{2,5})\s*(\d{1,3}[a-z]?)$/i);
  if (codeAndNumber) {
    return {
      AND: [
        { subject: { code: codeAndNumber[1].toUpperCase() } },
        { number: { startsWith: codeAndNumber[2].toUpperCase() } },
      ],
    };
  }

  if (/^[a-z]{2,5}$/i.test(q)) {
    return { subject: { code: q.toUpperCase() } };
  }

  return { title: { contains: q, mode: 'insensitive' } };
}

export type SectionHit = {
  sectionId: string;
  code: string;
  title: string;
  sectionCode: string;
  activity: string | null;
  meetings: string;
};

/**
 * Sections of matching courses within ONE term, for the schedule planner's
 * search sidebar. Term-scoped because a section from another term would never
 * render on that schedule's weekly grid.
 *
 * Reuses buildSearchWhere so "cpsc 221", "cpsc", and title prose all behave
 * exactly as they do in the site-wide course search.
 */
export async function searchSectionsForTerm(
  query: string,
  termId: string,
  limit = 40,
): Promise<SectionHit[]> {
  const q = query.trim();
  if (!q) return [];

  const sections = await db.section.findMany({
    where: { termId, course: { ...buildSearchWhere(q), campus: 'V' } },
    include: { meetingTimes: true, course: { include: { subject: true } } },
    take: limit,
    orderBy: [{ course: { number: 'asc' } }, { sectionCode: 'asc' }],
  });

  return sections.map((s) => ({
    sectionId: s.id,
    code: `${s.course.subject.code ?? ''} ${s.course.number}`.trim(),
    title: s.course.title,
    sectionCode: s.sectionCode,
    activity: s.activity,
    meetings:
      s.meetingTimes
        .filter((m) => m.startTime && m.endTime)
        .map((m) => `${m.day} ${m.startTime}–${m.endTime}`)
        .join(', ') || 'No fixed time',
  }));
}

export type SearchResult = { hits: CourseHit[]; total: number };

export async function searchCourses(query: string, limit = 25): Promise<SearchResult> {
  const where = { ...buildSearchWhere(query), campus: 'V' };
  const [courses, total] = await Promise.all([
    db.course.findMany({
      where,
      include: { subject: true },
      take: limit,
      orderBy: [{ subject: { code: 'asc' } }, { number: 'asc' }],
    }),
    db.course.count({ where }),
  ]);

  return {
    hits: courses.map((c) => ({
      code: `${c.subject.code} ${c.number}`,
      title: c.title,
      subjectName: c.subject.name,
    })),
    total,
  };
}
