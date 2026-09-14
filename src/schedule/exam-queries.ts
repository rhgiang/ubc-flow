import { db } from '@/lib/db';
import {
  compareItems,
  courseLabel,
  filterToOwnSection,
  toExamListItem,
  type ExamListItem,
} from '@/schedule/exams';

/**
 * The database side of the exam views. Server-only: this is the one exam
 * module that touches `@/lib/db`, kept apart from ./exams.ts so the pure
 * logic there (grouping, merging, section filtering) can be imported by the
 * client components without pulling pg into the browser bundle.
 */

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
    if (course && m.sectionCode) lectureSectionByCourse.set(courseLabel(course), m.sectionCode);
  }

  const items = exams
    .map((exam) => {
      const course = courseById.get(exam.courseId);
      if (!course) return null;
      return toExamListItem({ ...exam, course });
    })
    .filter((item): item is ExamListItem => item !== null);

  // Hiding and section filtering happen together: the hidden rows still count
  // towards what UBC published (see `filterToOwnSection`). Before `groupExams`
  // and before `mergeExams`: both count rows per course, and they should count
  // the student's own. `examCoverage` on the page includes the hidden rows,
  // so a course whose only visible section was hidden is still covered and is
  // never named as having no final.
  return filterToOwnSection(
    items,
    lectureSectionByCourse,
    new Set(hidden.map((h) => h.finalExamId)),
  ).sort(compareItems);
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
 *
 * Narrowed to what the student is still enrolled in, the same way
 * `examRowsForUser` above is. These rows carry their own userId, so this was
 * never an ownership hole, but an enrollment can go away without its
 * assessments: the importer prunes a re-uploaded term, and a student can
 * remove a course by hand. A course they are no longer in must not keep
 * posting midterms to the exam list, the month calendar or the feed.
 */
export async function syllabusExamRowsForUser(userId: string, termId: string): Promise<ExamListItem[]> {
  const enrolled = await db.enrollment.findMany({
    where: { userId, termId },
    select: { courseId: true },
  });
  const enrolledIds = [...new Set(enrolled.map((e) => e.courseId))];
  if (enrolledIds.length === 0) return [];

  const rows = await db.syllabusAssessment.findMany({
    where: { userId, termId, courseId: { in: enrolledIds }, kind: { in: ['midterm', 'final'] } },
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
        courseLabel: courseLabel(course),
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
