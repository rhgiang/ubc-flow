import { db } from '@/lib/db';

/**
 * One exam on the /exams page. Declared as a union from the start (`source`)
 * so Task 7 — which merges scraped finals with syllabus-derived midterms —
 * widens no types.
 */
export type ExamListItem = {
  id: string;
  courseLabel: string; // "BIOC 302"
  sectionCode: string;
  date: Date | null;
  startTime: string | null;
  location: string | null; // "BIOL 1000", null when unknown
  alphaSplit: string | null;
  notes: string | null;
  cancelled: boolean;
  source: 'ubc' | 'syllabus';
  /** Set only on syllabus rows a student edited; drives Task 7 precedence. */
  editedByUser?: boolean;
  /** Which kind of exam this is. Task 7 merges scraped finals with syllabus
   *  midterms and dedupes per course+kind, so this field is load-bearing. */
  kind: 'final' | 'midterm';
};

/** Shape `examRowsForUser` assembles by hand — `FinalExam` has no Prisma
 *  relation to `Course` (raw FK, same convention as the rest of this schema),
 *  so the join happens in JS rather than via `include`. */
type FinalExamRow = {
  id: string;
  sectionCode: string;
  date: Date | null;
  startTime: string | null;
  building: string | null;
  room: string | null;
  alphaSplit: string | null;
  notes: string | null;
  cancelled: boolean;
  course: { number: string; subject: { code: string | null } };
};

/** Pure: a scraped `FinalExam` row (joined with its course/subject) into the
 *  shape the exam view renders. Every row this produces is `kind: 'final'` —
 *  syllabus-derived midterms are a later task. */
export function toExamListItem(row: FinalExamRow): ExamListItem {
  const code = row.course.subject.code?.replace(/_[A-Z]$/, '') ?? '';
  return {
    id: row.id,
    courseLabel: `${code} ${row.course.number}`,
    sectionCode: row.sectionCode,
    date: row.date,
    startTime: row.startTime,
    location: row.building ? `${row.building}${row.room ? ` ${row.room}` : ''}` : null,
    alphaSplit: row.alphaSplit,
    notes: row.notes,
    cancelled: row.cancelled,
    source: 'ubc',
    kind: 'final',
  };
}

/** Sort key: dated, live exams first (ascending by date then start time);
 *  cancelled and dateless rows sink to the bottom regardless of date. */
function sortKey(item: ExamListItem): [number, number, string] {
  if (item.cancelled || !item.date) return [1, 0, ''];
  return [0, item.date.getTime(), item.startTime ?? ''];
}

function compareItems(a: ExamListItem, b: ExamListItem): number {
  const ka = sortKey(a);
  const kb = sortKey(b);
  return ka[0] - kb[0] || ka[1] - kb[1] || ka[2].localeCompare(kb[2]);
}

/** Every final exam a student has this term, from their `Enrollment` rows
 *  joined to `FinalExam` on course + term. */
export async function examRowsForUser(userId: string, termId: string): Promise<ExamListItem[]> {
  const enrollments = await db.enrollment.findMany({
    where: { userId, termId },
    select: { courseId: true },
  });
  const courseIds = [...new Set(enrollments.map((e) => e.courseId))];
  if (courseIds.length === 0) return [];

  const exams = await db.finalExam.findMany({
    where: { courseId: { in: courseIds }, termId },
  });
  if (exams.length === 0) return [];

  const courses = await db.course.findMany({
    where: { id: { in: [...new Set(exams.map((e) => e.courseId))] } },
    include: { subject: true },
  });
  const courseById = new Map(courses.map((c) => [c.id, c]));

  const items = exams
    .map((exam) => {
      const course = courseById.get(exam.courseId);
      if (!course) return null;
      return toExamListItem({ ...exam, course });
    })
    .filter((item): item is ExamListItem => item !== null);

  return items.sort(compareItems);
}
