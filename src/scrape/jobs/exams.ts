import { db } from '@/lib/db';
import { fetchText } from '@/scrape/http';
import { parseExamSchedule } from '@/scrape/parse-exams';

export const EXAM_SCHEDULE_URL = 'https://tools.students.ubc.ca/exam-schedule/';

/** Campus the published schedule covers. The table is UBCV only. */
const CAMPUS = 'V';

export async function fetchExamSchedule(): Promise<string> {
  return fetchText(EXAM_SCHEDULE_URL);
}

export async function ingestExams(html: string) {
  const { rows, term: inferred } = parseExamSchedule(html);
  const skipped: string[] = [];
  if (!inferred) return { written: 0, skipped };

  const term = await db.term.findFirst({
    where: {
      year: inferred.year,
      session: inferred.session,
      termNumber: inferred.termNumber,
      campus: CAMPUS,
    },
  });
  if (!term) {
    return {
      written: 0,
      skipped: rows.map((r) => `${r.subjectCode.replace(/_[A-Z]$/, '')} ${r.courseNumber}`),
    };
  }

  let written = 0;
  for (const row of rows) {
    // The parser preserves UBC's "_V" campus suffix; Subject.code does not carry it.
    const subjectCode = row.subjectCode.replace(/_[A-Z]$/, '');
    const course = await db.course.findFirst({
      where: {
        number: row.courseNumber,
        subject: { code: subjectCode, campus: CAMPUS },
      },
    });
    if (!course) {
      skipped.push(`${subjectCode} ${row.courseNumber}`);
      continue;
    }

    const data = {
      date: row.date ? new Date(`${row.date}T00:00:00Z`) : null,
      startTime: row.startTime,
      building: row.building,
      room: row.room,
      notes: row.notes,
      cancelled: row.cancelled,
    };

    // Upsert, never delete. A transient failure mid-run must leave last
    // week's schedule intact: stale exam data is useful, an emptied table the
    // night before finals is not.
    //
    // Not db.finalExam.upsert(): this Prisma version rejects `null` inside a
    // compound-unique `where`, and alphaSplit is null on most rows - the
    // upsert's own unique-key lookup would throw on exactly the common case.
    const existing = await db.finalExam.findFirst({
      where: {
        courseId: course.id,
        termId: term.id,
        sectionCode: row.sectionCode,
        alphaSplit: row.alphaSplit,
      },
    });
    if (existing) {
      await db.finalExam.update({ where: { id: existing.id }, data });
    } else {
      await db.finalExam.create({
        data: {
          courseId: course.id,
          termId: term.id,
          sectionCode: row.sectionCode,
          alphaSplit: row.alphaSplit,
          ...data,
        },
      });
    }
    written += 1;
  }

  return { written, skipped };
}
