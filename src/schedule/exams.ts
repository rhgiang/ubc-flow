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

/** Shape `syllabusExamRowsForUser` assembles by hand — `Syllabus.courseId` is
 *  a raw FK (same convention as `FinalExamRow` above), so the course/subject
 *  join happens in JS. */
type SyllabusAssessmentRow = {
  id: string;
  title: string;
  kind: string; // 'midterm' | 'final' | 'assignment' | 'quiz'
  date: Date | null;
  startTime: string | null;
  editedByUser: boolean;
};

/** Every confirmed midterm/final a student has this term, from their saved
 *  `SyllabusAssessment` rows. `assignment`/`quiz` rows don't belong on the
 *  exam page and are dropped. */
export async function syllabusExamRowsForUser(userId: string, termId: string): Promise<ExamListItem[]> {
  const syllabi = await db.syllabus.findMany({
    where: { userId, termId },
    include: { assessments: true },
  });
  if (syllabi.length === 0) return [];

  const courses = await db.course.findMany({
    where: { id: { in: [...new Set(syllabi.map((s) => s.courseId))] } },
    include: { subject: true },
  });
  const courseById = new Map(courses.map((c) => [c.id, c]));

  const items: ExamListItem[] = [];
  for (const syllabus of syllabi) {
    const course = courseById.get(syllabus.courseId);
    if (!course) continue;
    const code = course.subject.code?.replace(/_[A-Z]$/, '') ?? '';
    const courseLabel = `${code} ${course.number}`;

    for (const a of syllabus.assessments as SyllabusAssessmentRow[]) {
      if (a.kind !== 'midterm' && a.kind !== 'final') continue;
      items.push({
        id: a.id,
        courseLabel,
        sectionCode: '', // a syllabus assessment isn't tied to a section
        date: a.date,
        startTime: a.startTime,
        location: null,
        alphaSplit: null,
        notes: a.title,
        cancelled: false,
        source: 'syllabus',
        editedByUser: a.editedByUser,
        kind: a.kind,
      });
    }
  }

  return items.sort(compareItems);
}

/**
 * Merges scraped finals with syllabus-derived rows into one list, one row
 * per (courseLabel, kind). Midterms only ever come from syllabi, so they
 * never collide with a scraped final — a collision is only possible between
 * two finals for the same course. Precedence for that collision:
 *   1. `editedByUser` wins over everything.
 *   2. Otherwise a scraped ('ubc') row wins over a syllabus one — UBC's own
 *      schedule is authoritative over a syllabus saying "final exam,
 *      scheduled by the registrar".
 * Reuses `compareItems` for the final sort rather than a second ordering.
 */
export function mergeExams(scraped: ExamListItem[], fromSyllabus: ExamListItem[]): ExamListItem[] {
  const key = (item: ExamListItem) => `${item.courseLabel}::${item.kind}`;
  const byKey = new Map<string, ExamListItem>();

  for (const item of scraped) byKey.set(key(item), item);

  for (const item of fromSyllabus) {
    const existing = byKey.get(key(item));
    if (existing && existing.source === 'ubc' && !item.editedByUser) continue;
    byKey.set(key(item), item);
  }

  return [...byKey.values()].sort(compareItems);
}
