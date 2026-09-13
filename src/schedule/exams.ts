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
 * Merges scraped finals with syllabus-derived rows into one list.
 *
 * Nothing is deduped BETWEEN scraped rows. `examRowsForUser` joins on
 * courseId only (Enrollment carries no section), so one course routinely
 * returns several `FinalExam` rows — alpha splits (CHEM 123: ADI–SUN in
 * IRC 2, TAZ–ZHU in IRC 6) and every published section. Keying them per
 * course would keep whichever came last: half the class sent to the wrong
 * room, and — because `examRowsForUser` sorts cancelled/dateless rows last —
 * a cancelled section overwriting the student's real exam. Spec §4 put
 * `alphaSplit` in the unique key for exactly this reason; collapsing here
 * would undo it. So every scraped row passes through untouched.
 *
 * The only drop is a syllabus-derived one, in two cases, matching spec §9:
 *   1. A syllabus `final` when UBC already publishes a final for that course
 *      — UBC's own schedule is authoritative over a syllabus saying "final
 *      exam, scheduled by the registrar".
 *   2. Unless the student edited that row (`editedByUser`), which wins over
 *      everything — then the scraped final for that course goes instead.
 *
 * Case 2 applies only when the course has EXACTLY ONE scraped final. Spec §9
 * scopes that precedence to "when the same exam appears twice", and a sibling
 * alpha-split row is not the same exam: correcting a CHEM 123 final's date on
 * the confirm screen is ordinary use, and letting it displace a whole course's
 * scraped finals would take IRC 2 and IRC 6 off the page — the very failure
 * this function exists to prevent. With two or more, everything stays and the
 * source label on each card says which is which; one extra row beats a hidden
 * exam room.
 *
 * `kind: 'midterm'` rows only ever come from syllabi, there's nothing for
 * them to collide with, and a course usually has more than one, so every
 * midterm passes straight through.
 *
 * Reuses `compareItems` for the final sort rather than a second ordering.
 */
export function mergeExams(scraped: ExamListItem[], fromSyllabus: ExamListItem[]): ExamListItem[] {
  const scrapedFinalsPerCourse = new Map<string, number>();
  for (const i of scraped) {
    if (i.kind !== 'final') continue;
    scrapedFinalsPerCourse.set(i.courseLabel, (scrapedFinalsPerCourse.get(i.courseLabel) ?? 0) + 1);
  }
  const coursesWithEditedFinal = new Set(
    fromSyllabus.filter((i) => i.kind === 'final' && i.editedByUser).map((i) => i.courseLabel),
  );

  const keptScraped = scraped.filter(
    (i) => i.kind !== 'final'
      || scrapedFinalsPerCourse.get(i.courseLabel) !== 1
      || !coursesWithEditedFinal.has(i.courseLabel),
  );
  const keptSyllabus = fromSyllabus.filter(
    (i) => i.kind !== 'final' || i.editedByUser || !scrapedFinalsPerCourse.has(i.courseLabel),
  );

  return [...keptScraped, ...keptSyllabus].sort(compareItems);
}

/**
 * What the exam page can honestly say about a student's courses that have no
 * exam on it. Today it says nothing, and a student with six courses and four
 * exams cannot tell whether a course has NO final or whether its final simply
 * hasn't been published — opposite meanings rendered as the same blank space.
 *
 * The signal: UBC publishes a term's whole final exam schedule at once,
 * partway through term. So ONE `FinalExam` row anywhere in the term — any
 * course, not just this student's — proves the schedule is out, and an
 * enrolled course still missing from it has no registrar-scheduled final.
 * Before that first row nothing is known, and naming a course as having no
 * final would be the kind of lie that makes someone miss one.
 */
export type ExamCoverage =
  | { published: false }
  | { published: true; noFinal: string[] };

export function examCoverage(
  items: ExamListItem[],
  enrolledLabels: string[],
  termHasAnyExam: boolean,
): ExamCoverage {
  if (!termHasAnyExam) return { published: false };
  // A syllabus final counts as covered: the student has told us there IS one,
  // and naming the course below a card announcing it would contradict itself.
  // A cancelled row counts too — the registrar scheduled it and then pulled
  // it, which the struck-through card says better than this note could.
  // Midterms never count: they say nothing about whether a final exists.
  const withFinal = new Set(
    items.filter((i) => i.kind === 'final').map((i) => i.courseLabel),
  );
  return {
    published: true,
    noFinal: [...new Set(enrolledLabels)].filter((l) => !withFinal.has(l)).sort(),
  };
}
