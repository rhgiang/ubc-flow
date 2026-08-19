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

export async function searchCourses(query: string, limit = 25): Promise<CourseHit[]> {
  const courses = await db.course.findMany({
    where: { ...buildSearchWhere(query), campus: 'V' },
    include: { subject: true },
    take: limit,
    orderBy: [{ subject: { code: 'asc' } }, { number: 'asc' }],
  });

  return courses.map((c) => ({
    code: `${c.subject.code} ${c.number}`,
    title: c.title,
    subjectName: c.subject.name,
  }));
}
