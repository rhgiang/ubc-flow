import { db } from '@/lib/db';
import { hashStudentNumber } from '@/lib/hash';
import { EXCLUDED_REASON_TEXT, type ParsedExport } from '@/upload/parse-workday';

export type ImportResult = {
  matched: number;
  unmatched: string[];
  /**
   * Sections that were in the file, matched a course and a term, and still
   * put nothing on the calendar, as "CPSC 110 L1U": the parser found no
   * meeting day or no time for them. An empty or "To be determined" Meeting
   * Patterns cell lands here, and so does a genuinely online course, which
   * is true, it is not on the calendar. Named so a missing lab is a line on
   * screen instead of a section that vanished behind "Matched N courses".
   */
  unplaced: string[];
  /** Rows the parser skipped, each with the reason in words. A bare count told the student nothing. */
  excluded: { raw: string; reason: string }[];
  /** Credits earned elsewhere, stored but never an enrollment. */
  transfers: number;
  /** Enrollments dropped because they are no longer in the re-uploaded term. */
  removed: number;
  /**
   * Courses still on the account that this file said nothing about, as
   * "CPSC 110 (2026 Winter Term 1)".
   *
   * The prune below only touches terms the file covers, so a course dropped in
   * a term this export does not mention survives it. That is deliberate (see
   * `keptByTerm`), but it used to be silent, which is how a dropped course
   * could sit on an account through re-upload after re-upload with nothing on
   * screen to explain it. Naming them is what makes it recoverable: the
   * student can see the leftovers and remove them by hand.
   */
  untouched: string[];
  /**
   * Distinct `registrationStatus` values in the file that are not a plain
   * "Registered".
   *
   * Reported rather than acted on. We do not know Workday's vocabulary for a
   * dropped or withdrawn course, and guessing wrong deletes a real
   * registration, which is worse than keeping a stale one. Logged server-side
   * so the next real export tells us the words instead of us inventing them.
   */
  unexpectedStatuses: string[];
  /**
   * Header rows of further tables in the file that the parser does not read,
   * column labels only. A senior student's export can carry more than one
   * table; the parser stops at the first boundary, and until now the route
   * only mentioned that when it found no student number at all.
   */
  unparsedTables: string[];
  boundStudent: boolean;
};

export async function importExport(
  userId: string,
  parsed: ParsedExport,
): Promise<ImportResult> {
  let boundStudent = false;

  if (parsed.studentNumber) {
    const digest = hashStudentNumber(parsed.studentNumber);
    const owner = await db.user.findUnique({ where: { studentIdHash: digest } });

    // One student, one account. Without this a single genuine export could
    // verify unlimited accounts and manufacture a bot army (spec 5).
    if (owner && owner.id !== userId) {
      throw new Error('That student number is already linked to another account.');
    }

    // Once bound, an account's digest may never change to a DIFFERENT one -
    // only re-confirm the same one. Enrollments accumulate additively and are
    // never cleared on rebind, so an unguarded change would let one account
    // silently absorb a second, unrelated student's identity and history.
    const self = await db.user.findUniqueOrThrow({
      where: { id: userId },
      select: { studentIdHash: true },
    });
    if (self.studentIdHash && self.studentIdHash !== digest) {
      throw new Error('This account is already linked to a different student number.');
    }

    await db.user.update({
      where: { id: userId },
      data: { studentIdHash: digest, verifiedAt: new Date() },
    });
    boundStudent = true;
  }

  const unmatched: string[] = [];
  const unplaced = new Set<string>();
  const unparsedMeetings = new Set<string>();
  let matched = 0;
  // A section parses to one row per weekly pattern; it must count once.
  const countedSections = new Set<string>();
  // A course can have more than one registration row (lecture + lab), each
  // contributing its own meeting - cleared once per (course, term) so a
  // second row this run appends instead of wiping the first's meeting.
  const clearedMeetings = new Set<string>();
  // courseIds seen per term, so a re-upload can drop what the student is no
  // longer registered in. Only terms the file actually covers are touched -
  // a current-term export must never prune the academic-record terms.
  const keptByTerm = new Map<string, Set<string>>();

  for (const row of parsed.rows) {
    const course = await db.course.findFirst({
      where: {
        number: row.courseNumber,
        subject: { code: row.subjectCode, campus: row.campus },
      },
      select: { id: true },
    });

    // Academic-record rows carry no term at all (see EnrollmentRow.termYear),
    // so there is nothing to look up and nothing to fail on.
    const term =
      row.termYear === null || row.termSession === null
        ? null
        : await db.term.findFirst({
            where: {
              year: row.termYear,
              session: row.termSession,
              termNumber: row.termNumber,
              campus: row.campus,
            },
            select: { id: true },
          });

    // Reported, never silently dropped - a silent drop hides a catalogue gap
    // and leaves the user unable to review with no visible cause (spec 4.2).
    // A dated row whose term we cannot find is a gap; an undated row is not.
    if (!course || (!term && row.termYear !== null)) {
      unmatched.push(`${row.subjectCode} ${row.courseNumber}`);
      continue;
    }

    if (term) {
      await db.enrollment.upsert({
        where: {
          userId_courseId_termId: { userId, courseId: course.id, termId: term.id },
        },
        create: {
          userId,
          courseId: course.id,
          termId: term.id,
          source: 'workday',
          grade: row.grade,
          status: row.status,
          verified: true,
        },
        update: { grade: row.grade, status: row.status, verified: true },
      });
    } else {
      // upsert cannot address a null termId: Postgres treats every NULL as
      // distinct, so the compound unique never matches one and a re-upload
      // would stack duplicates. Find-then-write is the explicit version.
      const existing = await db.enrollment.findFirst({
        where: { userId, courseId: course.id, termId: null },
        select: { id: true },
      });
      if (existing) {
        await db.enrollment.update({
          where: { id: existing.id },
          data: { grade: row.grade, status: row.status, verified: true },
        });
      } else {
        await db.enrollment.create({
          data: {
            userId,
            courseId: course.id,
            termId: null,
            source: 'workday',
            grade: row.grade,
            status: row.status,
            verified: true,
          },
        });
      }
    }
    const sectionKey = `${course.id}:${term?.id ?? 'record'}:${row.sectionCode ?? ''}`;
    if (!countedSections.has(sectionKey)) {
      countedSections.add(sectionKey);
      matched += 1;
    }
    if (term) {
      const kept = keptByTerm.get(term.id) ?? new Set<string>();
      kept.add(course.id);
      keptByTerm.set(term.id, kept);
    }

    // Only dated rows: the academic record has no meeting pattern by design.
    // Nothing about what is written changes here, this is the report.
    if (term && (row.days.length === 0 || !row.meetingStartTime || !row.meetingEndTime)) {
      unplaced.add(
        `${row.subjectCode} ${row.courseNumber} ${row.sectionCode ?? row.activity ?? ''}`.trim(),
      );
      if (row.unparsedMeeting != null) unparsedMeetings.add(row.unparsedMeeting);
    }

    if (term && row.days.length > 0) {
      const key = `${course.id}:${term.id}`;
      if (!clearedMeetings.has(key)) {
        await db.enrollmentMeeting.deleteMany({
          where: { userId, courseId: course.id, termId: term.id },
        });
        clearedMeetings.add(key);
      }
      await db.enrollmentMeeting.create({
        data: {
          userId,
          courseId: course.id,
          termId: term.id,
          sectionCode: row.sectionCode,
          activity: row.activity,
          building: row.building,
          room: row.room,
          floor: row.floor,
          days: row.days,
          startTime: row.meetingStartTime,
          endTime: row.meetingEndTime,
          instructor: row.instructor,
          startDate: row.sectionStartDate ? new Date(row.sectionStartDate) : null,
          endDate: row.sectionEndDate ? new Date(row.sectionEndDate) : null,
        },
      });
    }
  }

  let removed = 0;
  for (const [termId, courseIds] of keptByTerm) {
    const stale = { userId, termId, courseId: { notIn: [...courseIds] } };
    removed += (await db.enrollment.deleteMany({ where: stale })).count;
    await db.enrollmentMeeting.deleteMany({ where: stale });
  }

  // Everything left in a dated term this file never covered. `not: null` is
  // explicit because SQL's NOT IN is NULL for a NULL column, and the
  // academic-record rows (termId null) are not "a term the file skipped" in
  // any sense a student would recognise.
  const leftovers = await db.enrollment.findMany({
    where: { userId, termId: { not: null, notIn: [...keptByTerm.keys()] } },
    select: { courseId: true, termId: true },
  });
  const untouched: string[] = [];
  if (leftovers.length > 0) {
    const [courses, terms] = await Promise.all([
      db.course.findMany({
        where: { id: { in: [...new Set(leftovers.map((l) => l.courseId))] } },
        select: { id: true, number: true, subject: { select: { code: true } } },
      }),
      db.term.findMany({
        where: { id: { in: [...new Set(leftovers.map((l) => l.termId as string))] } },
        select: { id: true, name: true },
      }),
    ]);
    const courseById = new Map(courses.map((c) => [c.id, c]));
    const termById = new Map(terms.map((t) => [t.id, t.name]));
    for (const l of leftovers) {
      const course = courseById.get(l.courseId);
      const termName = termById.get(l.termId as string);
      // A row whose course or term fell out of the catalogue has no name to
      // show, and a blank line helps nobody remove anything.
      if (!course || !termName) continue;
      untouched.push(`${course.subject.code} ${course.number} (${termName})`);
    }
    untouched.sort();
  }

  const unexpectedStatuses = [
    ...new Set(
      parsed.rows.flatMap((r) => {
        const s = r.registrationStatus?.trim();
        return s && s.toLowerCase() !== 'registered' ? [s] : [];
      }),
    ),
  ].sort();
  if (unexpectedStatuses.length > 0) {
    // Column values only, the same rule the upload route logs under: a
    // registration status is never a name, a number or a grade.
    console.error('import: unexpected registration statuses:', JSON.stringify(unexpectedStatuses));
  }
  if (unparsedMeetings.size > 0) {
    // The same rule: a Meeting Patterns cell is dates, days, times and rooms,
    // never a person. This is what tells us Workday's vocabulary for a day or
    // a time we could not read, without anyone sending their file.
    console.error('import: meeting segments not parsed:', JSON.stringify([...unparsedMeetings]));
  }

  /**
   * Transfer credit, stored rather than discarded.
   *
   * Deliberately NOT an Enrollment: it has no UBC term, often no UBC course,
   * and keeping it out of that table is what stops it reaching the review
   * gate. A degree plan still counts it, because UBC granted the credit.
   *
   * Replaced wholesale per import, the same way meetings are - a record that
   * no longer lists a transfer should not leave a stale row behind.
   */
  await db.transferCredit.deleteMany({ where: { userId } });
  for (const t of parsed.transfers) {
    const course =
      t.subjectCode && t.courseNumber
        ? await db.course.findFirst({
            where: {
              number: t.courseNumber,
              subject: { code: t.subjectCode, campus: t.campus ?? 'V' },
            },
            select: { id: true },
          })
        : null;
    await db.transferCredit.upsert({
      where: { userId_raw: { userId, raw: t.raw } },
      create: { userId, raw: t.raw, courseId: course?.id ?? null, credits: t.credits },
      update: { courseId: course?.id ?? null, credits: t.credits },
    });
  }

  return {
    matched,
    unmatched,
    unplaced: [...unplaced].sort(),
    excluded: parsed.excluded.map((e) => ({ raw: e.raw, reason: EXCLUDED_REASON_TEXT[e.reason] })),
    transfers: parsed.transfers.length,
    removed,
    untouched,
    unexpectedStatuses,
    unparsedTables: parsed.unparsedTables,
    boundStudent,
  };
}
