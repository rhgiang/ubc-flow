import { db } from '@/lib/db';
import type { Prisma } from '@prisma/client';

export type CourseHit = { code: string; title: string; subjectName: string; reviewCount: number };

/** "cpsc 221" -> code+number match; "cpsc" -> code; anything else -> title. */
export function buildSearchWhere(query: string): Prisma.CourseWhereInput {
  const q = query.trim();
  if (!q) return {};

  const codeAndNumber = q.match(/^([a-z]{2,5})\s*(\d{1,3}[a-z]?)$/i);
  if (codeAndNumber) {
    return {
      AND: [
        { subject: { code: { startsWith: codeAndNumber[1].toUpperCase() } } },
        { number: { startsWith: codeAndNumber[2].toUpperCase() } },
      ],
    };
  }

  // startsWith, not an exact match — a live-typed query like "c" or "cp"
  // needs to match "CPSC" before the whole code is typed.
  if (/^[a-z]{2,5}$/i.test(q)) {
    return { subject: { code: { startsWith: q.toUpperCase() } } };
  }

  return { title: { contains: q, mode: 'insensitive' } };
}

export type SectionMeetingTime = {
  day: string;
  startTime: string | null;
  endTime: string | null;
  building: string | null;
  room: string | null;
};

export type SectionHit = {
  sectionId: string;
  /** The COURSE this section belongs to — what the info overlay loads on. */
  courseId: string;
  code: string;
  title: string;
  sectionCode: string;
  activity: string | null;
  meetings: string;
  meetingTimes: SectionMeetingTime[];
  /** Instructor names, in the order the scrape returned them. */
  instructors: string[];
};

/**
 * The one include every toSectionHit caller must use — a shared const rather
 * than three hand-copied literals, which is how the shape drifted before.
 */
export const sectionHitInclude = {
  meetingTimes: true,
  instructors: { include: { instructor: true } },
  course: { include: { subject: true } },
} satisfies Prisma.SectionInclude;

type SectionRowForHit = Prisma.SectionGetPayload<{ include: typeof sectionHitInclude }>;

/**
 * Maps one section row (with meetingTimes and course.subject included) to the
 * SectionHit shape shared by the schedule planner's search sidebar and the
 * saved-schedule page — kept in one place so the two never drift.
 */
export function toSectionHit(s: SectionRowForHit): SectionHit {
  return {
    sectionId: s.id,
    courseId: s.courseId,
    code: `${s.course.subject.code ?? ''} ${s.course.number}`.trim(),
    title: s.course.title,
    sectionCode: s.sectionCode,
    activity: s.activity,
    meetings:
      s.meetingTimes
        .filter((m) => m.startTime && m.endTime)
        .map((m) => `${m.day} ${m.startTime}–${m.endTime}`)
        .join(', ') || 'No fixed time',
    meetingTimes: s.meetingTimes.map((m) => ({
      day: m.day,
      startTime: m.startTime,
      endTime: m.endTime,
      building: m.building,
      room: m.room,
    })),
    instructors: s.instructors.map((si) => si.instructor.name),
  };
}

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
    include: sectionHitInclude,
    take: limit,
    orderBy: [{ course: { number: 'asc' } }, { sectionCode: 'asc' }],
  });

  return sections.map(toSectionHit);
}

// Below this length, "title contains query" is mostly noise — a 2-letter
// query like "ec" matches "Directed", "Selected", "Technical", and dozens
// of other unrelated titles that happen to contain it mid-word.
const MIN_TITLE_MATCH_LENGTH = 3;

async function fetchCourseRows(where: Prisma.CourseWhereInput, limit: number) {
  return db.course.findMany({
    where: { ...where, campus: 'V' },
    include: { subject: true },
    take: limit,
    orderBy: [{ subject: { code: 'asc' } }, { number: 'asc' }],
  });
}

type CourseRow = Awaited<ReturnType<typeof fetchCourseRows>>[number];

/** Review counts for a set of course ids — the sole ranking signal within
 * each match tier below, and the reason liveCourseMatches fetches a wider
 * candidate pool than it returns (there's no way to ORDER BY a related
 * aggregate directly in a single Prisma query). */
async function courseReviewCounts(courseIds: string[]): Promise<Map<string, number>> {
  if (courseIds.length === 0) return new Map();
  const rows = await db.courseReview.groupBy({
    by: ['courseId'],
    where: { courseId: { in: courseIds } },
    _count: { _all: true },
  });
  return new Map(rows.map((r) => [r.courseId, r._count._all]));
}

async function instructorReviewCounts(instructorIds: string[]): Promise<Map<string, number>> {
  if (instructorIds.length === 0) return new Map();
  const rows = await db.instructorReview.groupBy({
    by: ['instructorId'],
    where: { instructorId: { in: instructorIds } },
    _count: { _all: true },
  });
  return new Map(rows.map((r) => [r.instructorId, r._count._all]));
}

async function rankByReviewCount(rows: CourseRow[]): Promise<CourseHit[]> {
  const counts = await courseReviewCounts(rows.map((c) => c.id));
  return [...rows]
    .sort((a, b) => (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0)) // stable: ties keep the incoming code/number order
    .map((c) => ({
      code: `${c.subject.code} ${c.number}`,
      title: c.title,
      subjectName: c.subject.name,
      reviewCount: counts.get(c.id) ?? 0,
    }));
}

// A wider pool than the final cap so ranking-by-review-count has more than
// "whatever happened to sort first alphabetically" to work with.
const CANDIDATE_POOL = 20;

/**
 * Course matches for the live dropdown, ranked rather than just filtered:
 * subject-code-prefix matches ("ec" -> ECON/ECED) fill the list first, since
 * that's the strongest, least ambiguous signal a short query can give — only
 * once those slots are exhausted, and only for queries long enough that a
 * substring match means something, do title matches fill the remainder.
 * Within each tier, the most-reviewed course goes first.
 */
async function liveCourseMatches(query: string, limit: number): Promise<CourseHit[]> {
  const codeAndNumber = query.match(/^([a-z]{2,5})\s*(\d{1,3}[a-z]?)$/i);
  if (codeAndNumber) {
    const rows = await fetchCourseRows(
      {
        AND: [
          { subject: { code: { startsWith: codeAndNumber[1].toUpperCase() } } },
          { number: { startsWith: codeAndNumber[2].toUpperCase() } },
        ],
      },
      CANDIDATE_POOL,
    );
    return (await rankByReviewCount(rows)).slice(0, limit);
  }

  const bySubjectRows = await fetchCourseRows(
    { subject: { code: { startsWith: query.toUpperCase() } } },
    CANDIDATE_POOL,
  );
  const bySubject = (await rankByReviewCount(bySubjectRows)).slice(0, limit);
  const remaining = limit - bySubject.length;
  if (remaining <= 0 || query.length < MIN_TITLE_MATCH_LENGTH) return bySubject;

  const excludeIds = bySubjectRows.map((c) => c.id);
  const byTitleRows = await fetchCourseRows(
    { title: { contains: query, mode: 'insensitive' }, id: { notIn: excludeIds } },
    CANDIDATE_POOL,
  );
  const byTitle = (await rankByReviewCount(byTitleRows)).slice(0, remaining);
  return [...bySubject, ...byTitle];
}

export type ProfessorHit = { slug: string; name: string; reviewCount: number };

/** Name matching only — course association (e.g. "econ" surfacing a
 * professor via a course they teach) proved too easy to trigger on a
 * coincidental substring in an unrelated course's title, with no way for
 * the dropdown to explain why that professor showed up. */
export async function searchProfessors(query: string, limit = 10): Promise<ProfessorHit[]> {
  const q = query.trim();
  if (!q) return [];

  const rows = await db.instructor.findMany({
    where: { campus: 'V', name: { contains: q, mode: 'insensitive' } },
    take: CANDIDATE_POOL,
    orderBy: { name: 'asc' },
    select: { id: true, slug: true, name: true },
  });
  const counts = await instructorReviewCounts(rows.map((r) => r.id));
  return [...rows]
    .sort((a, b) => (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0))
    .slice(0, limit)
    .map((r) => ({ slug: r.slug, name: r.name, reviewCount: counts.get(r.id) ?? 0 }));
}

/** The real subject a query names, if any — drives the "Explore all X…" label. */
async function detectSubject(query: string): Promise<string | null> {
  const codePart = query.match(/^([a-z]{2,5})/i)?.[1];
  if (!codePart) return null;

  const subject = await db.subject.findFirst({
    where: { campus: 'V', code: { startsWith: codePart.toUpperCase() } },
    orderBy: { code: 'asc' },
    select: { code: true },
  });
  return subject?.code ?? null;
}

export type LiveSearchResult = {
  courses: CourseHit[];
  professors: ProfessorHit[];
  exploreLabel: string;
  exploreHref: string;
};

const LIVE_COURSE_LIMIT = 5;
const LIVE_PROFESSOR_LIMIT = 3;

/**
 * Combined course+professor lookup for the homepage's live search dropdown.
 * Capped and non-exhaustive by design — same shape as UW Flow's own search,
 * which trades completeness for a fast, scannable list plus an "Explore
 * all…" escape hatch to the full filterable page.
 */
export async function searchAll(query: string): Promise<LiveSearchResult> {
  const q = query.trim();
  if (!q) {
    return { courses: [], professors: [], exploreLabel: 'courses and professors', exploreHref: '/explore' };
  }

  const [courses, professors, subject] = await Promise.all([
    liveCourseMatches(q, LIVE_COURSE_LIMIT),
    searchProfessors(q, LIVE_PROFESSOR_LIMIT),
    detectSubject(q),
  ]);

  return {
    courses,
    professors,
    exploreLabel: subject ? `${subject} courses and professors` : 'courses and professors',
    exploreHref: subject ? `/explore?subject=${subject}` : '/explore',
  };
}
