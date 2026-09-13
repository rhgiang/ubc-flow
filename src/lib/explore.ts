import { db } from '@/lib/db';
import type { Prisma } from '@prisma/client';
import { buildSearchWhere } from '@/lib/search';

export const PAGE_SIZE = 30;

/**
 * A rating average below this many reviews cannot rank above one at or over
 * it: with one review, a single 5/5 outranks fifty 4.6s, and a single bitter
 * 1/5 buries a course. Under the floor a course still sorts - by review
 * count, the default - it just cannot claim a leaderboard spot on a sample
 * of one or two.
 */
const MIN_RATINGS_FOR_SORT = 3;

export type CourseSort = 'ratings' | 'code' | 'name' | 'useful' | 'difficulty' | 'liked';
export type ProfessorSort = 'ratings' | 'name' | 'clear' | 'engaging' | 'liked';

export type CourseFilters = {
  q?: string;
  subject?: string;
  /** Subject.faculty verbatim, e.g. "Faculty of Science". */
  faculty?: string;
  levels?: number[]; // 1-4 = that hundred level, 5 = 500 and up
  termId?: string;
  requirements?: 'none' | 'has';
  sort?: CourseSort;
  page?: number;
};

export type CourseRow = {
  code: string;
  title: string;
  reviewCount: number;
  useful: number | null; // 1-5 display scale, matches the course page
  difficulty: number | null;
  likedPercent: number | null;
};

function levelWhere(levels: number[]): Prisma.CourseWhereInput {
  if (levels.length === 0) return {};
  const clauses = levels.map((lvl) =>
    lvl >= 5
      ? { OR: ['5', '6', '7', '8', '9'].map((d) => ({ number: { startsWith: d } })) }
      : { number: { startsWith: String(lvl) } },
  );
  return { OR: clauses };
}

type CourseStat = { count: number; useful: number | null; difficulty: number | null; likedPercent: number | null };

/**
 * Course averages: 0-4 stored, shown as 1-5 (same convention as the course
 * page). With almost no real reviews yet, most rows' stats are null/— -
 * this still queries for real rather than hardcoding blanks, so nothing
 * needs to change here as reviews accumulate.
 */
async function courseStats(courseIds: string[]): Promise<Map<string, CourseStat>> {
  if (courseIds.length === 0) return new Map();

  const [numeric, reviews] = await Promise.all([
    db.courseReview.groupBy({
      by: ['courseId'],
      where: { courseId: { in: courseIds } },
      _avg: { useful: true, difficulty: true },
      _count: { _all: true },
    }),
    db.courseReview.findMany({
      where: { courseId: { in: courseIds }, liked: { not: null } },
      select: { courseId: true, liked: true },
    }),
  ]);

  const likedByCourseTotal = new Map<string, { yes: number; total: number }>();
  for (const r of reviews) {
    const cur = likedByCourseTotal.get(r.courseId) ?? { yes: 0, total: 0 };
    cur.total += 1;
    if (r.liked) cur.yes += 1;
    likedByCourseTotal.set(r.courseId, cur);
  }

  const map = new Map<string, CourseStat>();
  for (const row of numeric) {
    const liked = likedByCourseTotal.get(row.courseId);
    map.set(row.courseId, {
      count: row._count._all,
      useful: row._avg.useful !== null ? row._avg.useful + 1 : null,
      difficulty: row._avg.difficulty !== null ? row._avg.difficulty + 1 : null,
      likedPercent: liked && liked.total > 0 ? Math.round((liked.yes / liked.total) * 100) : null,
    });
  }
  return map;
}

/**
 * Prisma can't ORDER BY a related review-count aggregate directly, so
 * ranking happens in two steps: fetch every course matching the current
 * filters (a few thousand rows at most - cheap at this catalogue's scale),
 * rank the whole set, THEN slice the page window. Pagination after ranking
 * (not before) is what makes "page 2" continue the same ordering rather than
 * re-sorting each page in isolation.
 */
export async function listCourses(
  filters: CourseFilters,
): Promise<{ rows: CourseRow[]; total: number }> {
  const levels = filters.levels ?? [];
  const page = Math.max(1, filters.page ?? 1);

  const where: Prisma.CourseWhereInput = {
    campus: 'V',
    ...(filters.q ? buildSearchWhere(filters.q) : {}),
    ...(filters.subject ? { subject: { code: filters.subject } } : {}),
    // A course has no degree of its own - degrees are programs. What a "BSc
    // course" actually means is one whose subject belongs to Science, so the
    // filter is by faculty and the labels name the degree it maps to.
    ...(filters.faculty ? { subject: { faculty: filters.faculty } } : {}),
    ...levelWhere(levels),
    ...(filters.requirements === 'none' ? { prereqText: null } : {}),
    ...(filters.requirements === 'has' ? { prereqText: { not: null } } : {}),
    ...(filters.termId ? { sections: { some: { termId: filters.termId } } } : {}),
  };

  const candidates = await db.course.findMany({
    where,
    select: { id: true, number: true, title: true, subject: { select: { code: true } } },
  });
  const total = candidates.length;
  const stats = await courseStats(candidates.map((c) => c.id));

  const codeCmp = (a: (typeof candidates)[number], b: (typeof candidates)[number]) =>
    (a.subject.code ?? '').localeCompare(b.subject.code ?? '') || a.number.localeCompare(b.number);

  const sort = filters.sort ?? 'ratings';
  const sorted = [...candidates].sort((a, b) => {
    if (sort === 'name') return a.title.localeCompare(b.title);
    if (sort === 'code') return codeCmp(a, b);
    if (sort === 'useful' || sort === 'difficulty' || sort === 'liked') {
      const aRated = (stats.get(a.id)?.count ?? 0) >= MIN_RATINGS_FOR_SORT;
      const bRated = (stats.get(b.id)?.count ?? 0) >= MIN_RATINGS_FOR_SORT;
      if (aRated !== bRated) return aRated ? -1 : 1;
      if (aRated) {
        const field = sort === 'liked' ? 'likedPercent' : sort;
        const av = stats.get(a.id)?.[field];
        const bv = stats.get(b.id)?.[field];
        if (av !== bv) return (bv ?? -1) - (av ?? -1);
      }
    }
    // Default, and the tiebreak for every other sort: most-reviewed first,
    // then alphabetical - the only ranking that means anything while real
    // review coverage is still this sparse.
    const countDiff = (stats.get(b.id)?.count ?? 0) - (stats.get(a.id)?.count ?? 0);
    return countDiff !== 0 ? countDiff : codeCmp(a, b);
  });

  const pageRows = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return {
    total,
    rows: pageRows.map((c) => {
      const s = stats.get(c.id);
      return {
        code: `${c.subject.code} ${c.number}`,
        title: c.title,
        reviewCount: s?.count ?? 0,
        useful: s?.useful ?? null,
        difficulty: s?.difficulty ?? null,
        likedPercent: s?.likedPercent ?? null,
      };
    }),
  };
}

export type ProfessorFilters = {
  q?: string;
  /** Match professors teaching ANY of these subject codes. */
  teachesSubjects?: string[];
  sort?: ProfessorSort;
  page?: number;
};

export type ProfessorRow = {
  slug: string;
  name: string;
  reviewCount: number;
  clear: number | null;
  engaging: number | null;
  likedPercent: number | null;
};

type ProfessorStat = { count: number; clear: number | null; engaging: number | null; likedPercent: number | null };

async function professorStats(instructorIds: string[]): Promise<Map<string, ProfessorStat>> {
  if (instructorIds.length === 0) return new Map();

  const [numeric, reviews] = await Promise.all([
    db.instructorReview.groupBy({
      by: ['instructorId'],
      where: { instructorId: { in: instructorIds } },
      _avg: { clear: true, engaging: true },
      _count: { _all: true },
    }),
    db.instructorReview.findMany({
      where: { instructorId: { in: instructorIds }, liked: { not: null } },
      select: { instructorId: true, liked: true },
    }),
  ]);

  const likedByInstructorTotal = new Map<string, { yes: number; total: number }>();
  for (const r of reviews) {
    const cur = likedByInstructorTotal.get(r.instructorId) ?? { yes: 0, total: 0 };
    cur.total += 1;
    if (r.liked) cur.yes += 1;
    likedByInstructorTotal.set(r.instructorId, cur);
  }

  const map = new Map<string, ProfessorStat>();
  for (const row of numeric) {
    const liked = likedByInstructorTotal.get(row.instructorId);
    map.set(row.instructorId, {
      count: row._count._all,
      clear: row._avg.clear !== null ? row._avg.clear + 1 : null,
      engaging: row._avg.engaging !== null ? row._avg.engaging + 1 : null,
      likedPercent: liked && liked.total > 0 ? Math.round((liked.yes / liked.total) * 100) : null,
    });
  }
  return map;
}

export async function listProfessors(
  filters: ProfessorFilters,
): Promise<{ rows: ProfessorRow[]; total: number }> {
  const page = Math.max(1, filters.page ?? 1);

  const where: Prisma.InstructorWhereInput = {
    campus: 'V',
    ...(filters.q ? { name: { contains: filters.q, mode: 'insensitive' } } : {}),
    ...(filters.teachesSubjects?.length
      ? {
          sections: {
            some: { section: { course: { subject: { code: { in: filters.teachesSubjects } } } } },
          },
        }
      : {}),
  };

  const candidates = await db.instructor.findMany({ where, select: { id: true, slug: true, name: true } });
  const total = candidates.length;
  const stats = await professorStats(candidates.map((i) => i.id));

  const sort = filters.sort ?? 'ratings';
  const sorted = [...candidates].sort((a, b) => {
    if (sort === 'name') return a.name.localeCompare(b.name);
    if (sort === 'clear' || sort === 'engaging' || sort === 'liked') {
      const aRated = (stats.get(a.id)?.count ?? 0) >= MIN_RATINGS_FOR_SORT;
      const bRated = (stats.get(b.id)?.count ?? 0) >= MIN_RATINGS_FOR_SORT;
      if (aRated !== bRated) return aRated ? -1 : 1;
      if (aRated) {
        const field = sort === 'liked' ? 'likedPercent' : sort;
        const av = stats.get(a.id)?.[field];
        const bv = stats.get(b.id)?.[field];
        if (av !== bv) return (bv ?? -1) - (av ?? -1);
      }
    }
    const countDiff = (stats.get(b.id)?.count ?? 0) - (stats.get(a.id)?.count ?? 0);
    return countDiff !== 0 ? countDiff : a.name.localeCompare(b.name);
  });

  const pageRows = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return {
    total,
    rows: pageRows.map((i) => {
      const s = stats.get(i.id);
      return {
        slug: i.slug,
        name: i.name,
        reviewCount: s?.count ?? 0,
        clear: s?.clear ?? null,
        engaging: s?.engaging ?? null,
        likedPercent: s?.likedPercent ?? null,
      };
    }),
  };
}
