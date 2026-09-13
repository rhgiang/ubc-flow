import { db } from '@/lib/db';

/**
 * One exam on the /exams page. Declared as a union from the start (`source`)
 * so Task 7 - which merges scraped finals with syllabus-derived midterms -
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
  /** Set on syllabus rows a student edited or typed by hand. `mergeExams`
   *  keeps such a final beside UBC's instead of dropping it. */
  editedByUser?: boolean;
  /** Which kind of exam this is. Task 7 merges scraped finals with syllabus
   *  midterms and dedupes per course+kind, so this field is load-bearing. */
  kind: 'final' | 'midterm';
  /** Set when the course published several exam sections and we could not tell
   *  which one is the student's - see `filterToOwnSection`. Every section is
   *  shown, and the flag is what stops that reading as "you have two exams". */
  ambiguousSection?: boolean;
};

/** Shape `examRowsForUser` assembles by hand - `FinalExam` has no Prisma
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

/** "BIOC 302" - the campus-suffixed catalogue spelling ("BIOC_V") is not what
 *  a student reads, and every consumer keys on this one. */
function courseLabelOf(course: { number: string; subject: { code: string | null } }): string {
  return `${course.subject.code?.replace(/_[A-Z]$/, '') ?? ''} ${course.number}`;
}

/** Pure: a scraped `FinalExam` row (joined with its course/subject) into the
 *  shape the exam view renders. Every row this produces is `kind: 'final'` -
 *  syllabus-derived midterms are a later task. */
export function toExamListItem(row: FinalExamRow): ExamListItem {
  return {
    id: row.id,
    courseLabel: courseLabelOf(row.course),
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

/** Section codes are compared, never displayed, through this: the exam table
 *  and a Workday export are two different transcriptions of the same string. */
function sameSection(a: string): string {
  return a.trim().toUpperCase();
}

/**
 * UBC splits a big exam across rooms by surname, publishing one row per room.
 * Those rows are the SAME exam, and rendering them as separate cards reads as
 * "you have two BIOL 121 exams" - which is how the first person to see this
 * page read it. Group them so one exam is one card, listing each room against
 * the surnames that go to it.
 *
 * The key deliberately excludes alphaSplit, building and room - those are what
 * differ WITHIN a group. Two genuinely separate exams for one course (a
 * midterm and a final, or two midterms) differ by kind or date and stay apart.
 */
export function groupKey(item: ExamListItem): string {
  return [
    item.courseLabel,
    item.kind,
    item.date ? item.date.toISOString() : 'no-date',
    item.startTime ?? 'no-time',
    item.source,
  ].join('|');
}

export function groupExams(items: ExamListItem[]): ExamListItem[][] {
  const groups = new Map<string, ExamListItem[]>();
  for (const item of items) {
    const key = groupKey(item);
    const existing = groups.get(key);
    if (existing) existing.push(item);
    else groups.set(key, [item]);
  }
  return [...groups.values()];
}

/**
 * Drops the other sections' exams.
 *
 * `Enrollment` carries no section, so the course+term join brings back every
 * published section of a course - and 8 of the 108 courses in UBC's table
 * publish more than one (PHIL_V 347 001/002, ENGL_V 110 JL1/JL2, LAW_V 505
 * 98A/98B). A student in one of them was shown both exams, at different times
 * in different buildings, with nothing saying which was theirs.
 *
 * `lectureSectionByCourse` is their own section per course label, from their
 * Workday import - the LECTURE one only. A lab's "L1U" or a tutorial's "T2M"
 * is not an exam section and would match nothing.
 *
 * Three cases, in order of how much we know:
 *   - One published section: nothing to choose between. Untouched - this is
 *     the overwhelming majority, and it stays a no-op.
 *   - Several, and their lecture section is one of them: only that one.
 *   - Several, and we don't know theirs (never imported Workday) or it matches
 *     none of them: ALL of them, flagged `ambiguousSection`. Guessing sends
 *     someone to the wrong room; hiding one loses a real exam. Neither is
 *     worth saving them a glance at a label.
 *
 * `alphaSplit` is a different axis: rows sharing a `sectionCode` are ONE exam
 * in several rooms, and they pass through together - grouping them is
 * `groupExams`' job, downstream of this.
 */
export function filterToOwnSection(
  items: ExamListItem[],
  lectureSectionByCourse: Map<string, string>,
): ExamListItem[] {
  const publishedByCourse = new Map<string, Set<string>>();
  for (const i of items) {
    const seen = publishedByCourse.get(i.courseLabel) ?? new Set<string>();
    seen.add(sameSection(i.sectionCode));
    publishedByCourse.set(i.courseLabel, seen);
  }

  return items.flatMap((item) => {
    const published = publishedByCourse.get(item.courseLabel)!;
    if (published.size < 2) return [item];

    const mine = lectureSectionByCourse.get(item.courseLabel);
    const mineCode = mine ? sameSection(mine) : null;
    if (mineCode && published.has(mineCode)) {
      return sameSection(item.sectionCode) === mineCode ? [item] : [];
    }
    return [{ ...item, ambiguousSection: true }];
  });
}

/**
 * Drops the scraped rows this student has hidden.
 *
 * A `FinalExam` is global - one row per published exam, read by every student
 * in the course - so "remove this from my exams" is a per-user marker
 * (`HiddenFinalExam`), never a delete. This is where the marker is applied,
 * and it is applied in `examRowsForUser` so that every consumer gets it: the
 * page, the shared page, and the subscribed ICS feed.
 *
 * Syllabus rows are never in this set: those belong to the student and are
 * deleted outright, so there is nothing to hide.
 */
export function withoutHidden(items: ExamListItem[], hiddenIds: Set<string>): ExamListItem[] {
  return items.filter((i) => i.source !== 'ubc' || !hiddenIds.has(i.id));
}

/** Every final exam a student has this term, from their `Enrollment` rows
 *  joined to `FinalExam` on course + term, narrowed to their own section,
 *  minus whatever they have hidden. */
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

  const [courses, lectures, hidden] = await Promise.all([
    db.course.findMany({
      where: { id: { in: [...new Set(exams.map((e) => e.courseId))] } },
      include: { subject: true },
    }),
    // The student's own section, for the courses that publish more than one
    // exam. Workday's "Instructional Format" is the activity: only the lecture
    // row's code is the one UBC's exam table publishes against.
    db.enrollmentMeeting.findMany({
      where: { userId, termId, courseId: { in: courseIds }, activity: 'Lecture' },
      select: { courseId: true, sectionCode: true },
    }),
    db.hiddenFinalExam.findMany({
      where: { userId, finalExamId: { in: exams.map((e) => e.id) } },
      select: { finalExamId: true },
    }),
  ]);
  const courseById = new Map(courses.map((c) => [c.id, c]));

  const lectureSectionByCourse = new Map<string, string>();
  for (const m of lectures) {
    const course = courseById.get(m.courseId);
    if (course && m.sectionCode) lectureSectionByCourse.set(courseLabelOf(course), m.sectionCode);
  }

  const items = exams
    .map((exam) => {
      const course = courseById.get(exam.courseId);
      if (!course) return null;
      return toExamListItem({ ...exam, course });
    })
    .filter((item): item is ExamListItem => item !== null);

  // Hidden rows go first, so a student who hides the section that is not
  // theirs leaves one published section behind and stops being asked which of
  // the two is theirs.
  const visible = withoutHidden(items, new Set(hidden.map((h) => h.finalExamId)));

  // Before `groupExams` and before `mergeExams`: both count rows per course,
  // and they should count the student's own. `examCoverage` is unaffected -
  // this never empties a course that had an exam, so a course still on the
  // page is never named as having no final.
  return filterToOwnSection(visible, lectureSectionByCourse).sort(compareItems);
}

/**
 * What this student has hidden, as exam rows - so the page can list them and
 * offer each one back. Deliberately not run through `filterToOwnSection`:
 * these are the rows the student removed by hand, and every one of them has
 * to be findable again, including the other section's exam they hid on
 * purpose.
 */
export async function hiddenExamRowsForUser(userId: string, termId: string): Promise<ExamListItem[]> {
  const hidden = await db.hiddenFinalExam.findMany({
    where: { userId },
    select: { finalExamId: true },
  });
  if (hidden.length === 0) return [];

  const exams = await db.finalExam.findMany({
    where: { id: { in: hidden.map((h) => h.finalExamId) }, termId },
  });
  if (exams.length === 0) return [];

  const courses = await db.course.findMany({
    where: { id: { in: [...new Set(exams.map((e) => e.courseId))] } },
    include: { subject: true },
  });
  const courseById = new Map(courses.map((c) => [c.id, c]));

  return exams
    .flatMap((exam) => {
      const course = courseById.get(exam.courseId);
      return course ? [toExamListItem({ ...exam, course })] : [];
    })
    .sort(compareItems);
}

/**
 * Every confirmed midterm/final a student has this term, from their saved
 * `SyllabusAssessment` rows - both the ones read out of a syllabus and the
 * ones they typed into the exam view, which have no syllabus at all.
 *
 * Asked of the assessment rows directly rather than through `Syllabus`, which
 * is what a standalone row makes possible: the student, course and term are on
 * the row itself now. `assignment`/`quiz` rows don't belong on the exam page
 * and are dropped. `courseId` is a raw FK (same convention as `FinalExamRow`
 * above), so the course/subject join happens in JS.
 */
export async function syllabusExamRowsForUser(userId: string, termId: string): Promise<ExamListItem[]> {
  const rows = await db.syllabusAssessment.findMany({
    where: { userId, termId, kind: { in: ['midterm', 'final'] } },
  });
  if (rows.length === 0) return [];

  const courses = await db.course.findMany({
    where: { id: { in: [...new Set(rows.map((r) => r.courseId))] } },
    include: { subject: true },
  });
  const courseById = new Map(courses.map((c) => [c.id, c]));

  return rows
    .flatMap((a): ExamListItem[] => {
      const course = courseById.get(a.courseId);
      if (!course) return [];
      return [{
        id: a.id,
        courseLabel: courseLabelOf(course),
        sectionCode: '', // a syllabus assessment isn't tied to a section
        date: a.date,
        startTime: a.startTime,
        location: a.location,
        alphaSplit: null,
        notes: a.title,
        cancelled: false,
        source: 'syllabus',
        editedByUser: a.editedByUser,
        kind: a.kind as 'midterm' | 'final',
      }];
    })
    .sort(compareItems);
}

/**
 * Merges scraped finals with syllabus-derived rows into one list.
 *
 * NOTHING EVER DISPLACES A SCRAPED ROW. Every `FinalExam` row passes through
 * untouched, whatever the syllabus rows say. Two rules that guessed otherwise
 * each produced a hidden real exam on this branch:
 *   - keying scraped rows per course kept whichever came last, so an alpha
 *     split (CHEM 123: ADI-SUN in IRC 2, TAZ-ZHU in IRC 6) lost a room and a
 *     cancelled section overwrote the live one;
 *   - letting an edited or hand-typed syllabus final replace the scraped one
 *     meant a student who typed "CPSC 110 final, date TBA" in September never
 *     saw the row UBC published in November. The page said "Date TBA", the
 *     feed carried nothing, and nothing on screen said UBC disagreed. The same
 *     rule swallowed a cancellation notice.
 * When a syllabus or manual final sits beside a scraped final for the same
 * course, BOTH render, each labelled with its source, and the student can hide
 * UBC's if they truly disagree. One extra card beats a hidden exam.
 *
 * The only drop is in the other direction: a syllabus final the student did
 * NOT edit is dropped when UBC publishes a final for that course. That row is
 * the model reading "final exam, scheduled by the registrar" off a PDF, with
 * no date, and UBC's own schedule is authoritative over it. An edited or
 * hand-typed final (`editedByUser`) is kept: the student put that date there
 * on purpose, so it stays until they remove it.
 *
 * `kind: 'midterm'` rows only ever come from syllabi, there's nothing for
 * them to collide with, and a course usually has more than one, so every
 * midterm passes straight through.
 *
 * Reuses `compareItems` for the final sort rather than a second ordering.
 */
export function mergeExams(scraped: ExamListItem[], fromSyllabus: ExamListItem[]): ExamListItem[] {
  const coursesWithScrapedFinal = new Set(
    scraped.filter((i) => i.kind === 'final').map((i) => i.courseLabel),
  );
  const keptSyllabus = fromSyllabus.filter(
    (i) => i.kind !== 'final' || i.editedByUser || !coursesWithScrapedFinal.has(i.courseLabel),
  );
  return [...scraped, ...keptSyllabus].sort(compareItems);
}

/**
 * What the exam page can honestly say about a student's courses that have no
 * exam on it. Today it says nothing, and a student with six courses and four
 * exams cannot tell whether a course has NO final or whether its final simply
 * hasn't been published - opposite meanings rendered as the same blank space.
 *
 * The signal: UBC publishes a term's whole final exam schedule at once,
 * partway through term. So ONE `FinalExam` row anywhere in the term - any
 * course, not just this student's - proves the schedule is out, and an
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
  // A cancelled row counts too - the registrar scheduled it and then pulled
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
