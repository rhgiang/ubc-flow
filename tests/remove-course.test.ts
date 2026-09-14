import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import type { ParsedExport } from '@/upload/parse-workday';

// The only outbound call `removeCourseFor` can make. Stubbed so a test never
// needs a blob token, and so the one syllabus with a pathname can assert the
// file is deleted alongside the row.
vi.mock('@vercel/blob', () => ({ del: vi.fn(async () => {}) }));

const { db } = await import('@/lib/db');
const { del } = await import('@vercel/blob');
const { removeCourseFor } = await import('@/app/actions/account');
const { syllabusExamRowsForUser } = await import('@/schedule/exam-queries');
const { importExport } = await import('@/upload/import');

const OWNER = 'zz-remove-owner@example.com';
const STRANGER = 'zz-remove-stranger@example.com';

let ownerId: string;
let strangerId: string;
let courseId: string;
let termId: string;
let courseLabel: string;
let termName: string;

// A second catalogued (course, term) pair, in a DIFFERENT term: the file the
// import test uploads covers only this one, which is what leaves the pair
// above untouched.
let otherCourseId: string;
let otherTermId: string;
let otherRow: {
  subjectCode: string;
  courseNumber: string;
  termYear: number;
  termSession: string;
  termNumber: number | null;
};

beforeAll(async () => {
  process.env.SERVER_SECRET ??= 'test-secret';
  await db.user.deleteMany({ where: { email: { in: [OWNER, STRANGER] } } });
  ownerId = (await db.user.create({ data: { email: OWNER } })).id;
  strangerId = (await db.user.create({ data: { email: STRANGER } })).id;

  // Taken off a Section so the course and the term are a pair the catalogue
  // really has, not two rows picked independently.
  const section = await db.section.findFirstOrThrow({
    where: { term: { campus: 'V' }, course: { subject: { code: { not: null } } } },
    select: { courseId: true, termId: true },
  });
  courseId = section.courseId;
  termId = section.termId;

  const course = await db.course.findUniqueOrThrow({
    where: { id: courseId },
    select: { number: true, subject: { select: { code: true } } },
  });
  courseLabel = `${course.subject.code} ${course.number}`;
  termName = (await db.term.findUniqueOrThrow({ where: { id: termId } })).name;

  const other = await db.section.findFirstOrThrow({
    where: {
      termId: { not: termId },
      term: { campus: 'V' },
      course: { subject: { code: { not: null } } },
    },
    select: {
      courseId: true,
      termId: true,
      course: { select: { number: true, subject: { select: { code: true } } } },
      term: { select: { year: true, session: true, termNumber: true } },
    },
  });
  otherCourseId = other.courseId;
  otherTermId = other.termId;
  otherRow = {
    // Non-null by the query's own filter above.
    subjectCode: other.course.subject.code as string,
    courseNumber: other.course.number,
    termYear: other.term.year,
    termSession: other.term.session,
    termNumber: other.term.termNumber,
  };
});

afterEach(async () => {
  vi.mocked(del).mockClear();
  for (const userId of [ownerId, strangerId]) {
    await db.syllabusAssessment.deleteMany({ where: { userId } });
    await db.syllabus.deleteMany({ where: { userId } });
    await db.enrollmentMeeting.deleteMany({ where: { userId } });
    await db.enrollment.deleteMany({ where: { userId } });
  }
});

afterAll(async () => {
  await db.user.deleteMany({ where: { email: { in: [OWNER, STRANGER] } } });
  await db.$disconnect();
});

async function enrollOwner() {
  await db.enrollment.create({ data: { userId: ownerId, courseId, termId, source: 'test' } });
}

async function ownerMidterm(title = 'Midterm 1', syllabusId: string | null = null) {
  return db.syllabusAssessment.create({
    data: {
      userId: ownerId,
      courseId,
      termId,
      syllabusId,
      title,
      kind: 'midterm',
      date: new Date('2026-10-14T00:00:00Z'),
      startTime: '18:00',
      editedByUser: true,
    },
  });
}

describe('removing a course by hand', () => {
  it('deletes the enrollment, its meetings and its exams together', async () => {
    await enrollOwner();
    await db.enrollmentMeeting.create({
      data: { userId: ownerId, courseId, termId, days: ['Mon'], sectionCode: '101' },
    });
    await ownerMidterm();

    expect(await removeCourseFor(ownerId, courseId, termId)).toEqual({ ok: true });

    expect(await db.enrollment.count({ where: { userId: ownerId } })).toBe(0);
    expect(await db.enrollmentMeeting.count({ where: { userId: ownerId } })).toBe(0);
    // Including the standalone rows typed straight into the exam view, which
    // have no syllabusId and so would outlive a syllabus-only delete.
    expect(await db.syllabusAssessment.count({ where: { userId: ownerId } })).toBe(0);
  });

  it('deletes the syllabus and its private file, so no blob is orphaned', async () => {
    await enrollOwner();
    const syllabus = await db.syllabus.create({
      data: {
        userId: ownerId,
        courseId,
        termId,
        pathname: 'syllabi/zz-remove-test.pdf',
        filename: 'syllabus.pdf',
        size: 10,
      },
    });
    await ownerMidterm('Midterm 1', syllabus.id);

    expect(await removeCourseFor(ownerId, courseId, termId)).toEqual({ ok: true });

    expect(vi.mocked(del)).toHaveBeenCalledWith('syllabi/zz-remove-test.pdf');
    expect(await db.syllabus.count({ where: { userId: ownerId } })).toBe(0);
  });

  it('keeps the row when the file cannot be deleted, rather than orphaning it', async () => {
    await enrollOwner();
    await db.syllabus.create({
      data: { userId: ownerId, courseId, termId, pathname: 'syllabi/zz-remove-fail.pdf' },
    });
    vi.mocked(del).mockRejectedValueOnce(new Error('blob store unreachable'));

    const result = await removeCourseFor(ownerId, courseId, termId);
    expect(result.ok).toBe(false);
    expect(await db.enrollment.count({ where: { userId: ownerId } })).toBe(1);
    expect(await db.syllabus.count({ where: { userId: ownerId } })).toBe(1);
  });

  it('never touches another student’s course, and never admits it exists', async () => {
    await enrollOwner();

    const notMine = await removeCourseFor(strangerId, courseId, termId);
    const notReal = await removeCourseFor(strangerId, 'no-such-course-id', termId);

    // Byte for byte the same answer: a 403 here would confirm to a stranger
    // that this student is enrolled in this course.
    expect(notMine).toEqual({ ok: false, error: 'Not found.' });
    expect(notReal).toEqual(notMine);
    expect(await db.enrollment.count({ where: { userId: ownerId, courseId, termId } })).toBe(1);
  });

  it('removes a term-less academic-record course', async () => {
    await db.enrollment.create({
      data: { userId: ownerId, courseId, termId: null, source: 'test' },
    });

    expect(await removeCourseFor(ownerId, courseId, null)).toEqual({ ok: true });
    expect(await db.enrollment.count({ where: { userId: ownerId } })).toBe(0);
  });
});

describe('exams of a course the student is no longer in', () => {
  it('stops showing a removed course’s syllabus midterms', async () => {
    await enrollOwner();
    await ownerMidterm();

    const before = await syllabusExamRowsForUser(ownerId, termId);
    expect(before.map((i) => i.courseLabel)).toEqual([courseLabel]);

    await removeCourseFor(ownerId, courseId, termId);
    expect(await syllabusExamRowsForUser(ownerId, termId)).toEqual([]);
  });

  // The other way in: the importer prunes an enrollment when a re-uploaded
  // term no longer lists the course, and has never touched the assessments.
  it('hides a midterm whose enrollment the importer pruned', async () => {
    await ownerMidterm();
    expect(await syllabusExamRowsForUser(ownerId, termId)).toEqual([]);
  });
});

describe('what an import leaves alone', () => {
  const baseRow = {
    grade: null,
    status: 'registered' as const,
    campus: 'V',
    sectionCode: '101',
    activity: 'Lecture',
    building: null,
    room: null,
    floor: null,
    startDate: null,
    days: [] as string[],
    meetingStartTime: null,
    meetingEndTime: null,
    meetingEndDate: null,
    credits: null,
    registrationStatus: 'Registered' as string | null,
    deliveryMode: null,
    instructor: null,
    sectionStartDate: null,
    sectionEndDate: null,
  };

  function exportCovering(registrationStatus: string | null = 'Registered'): ParsedExport {
    return {
      // Null so the import never binds a student number: this test is about
      // the prune, not about verification.
      studentNumber: null,
      transfers: [],
      excluded: [],
      unparsedTables: [],
      rows: [{ ...baseRow, ...otherRow, registrationStatus }],
    };
  }

  it('names the courses it kept because the file said nothing about their term', async () => {
    await enrollOwner();

    const result = await importExport(ownerId, exportCovering());

    // The academic-record protection, unchanged: a file that covers only one
    // term must not prune the others.
    expect(result.removed).toBe(0);
    expect(result.untouched).toEqual([`${courseLabel} (${termName})`]);
    expect(
      await db.enrollment.count({ where: { userId: ownerId, courseId, termId } }),
    ).toBe(1);
    // The course the file DID cover is not reported as untouched.
    expect(result.untouched).not.toContain(otherCourseId);
  });

  // The academic-record export dates nothing, so it covers no term at all.
  // Every dated course on the account is untouched by definition, and that is
  // exactly the upload where pruning would wipe a student's whole timetable.
  it('reports every dated course when the file covers no term', async () => {
    await enrollOwner();

    const record = exportCovering();
    record.rows = [
      { ...record.rows[0], termYear: null, termSession: null, termNumber: null },
    ];

    const result = await importExport(ownerId, record);
    expect(result.removed).toBe(0);
    expect(result.untouched).toEqual([`${courseLabel} (${termName})`]);
  });

  it('reports nothing when every enrolled term is in the file', async () => {
    const result = await importExport(ownerId, exportCovering());
    expect(result.untouched).toEqual([]);
  });

  it('surfaces an unrecognised registration status instead of acting on it', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const result = await importExport(ownerId, exportCovering('Dropped'));

      expect(result.unexpectedStatuses).toEqual(['Dropped']);
      expect(logged.mock.calls[0]?.join(' ')).toContain('Dropped');
      // Still imported. Guessing that "Dropped" means dropped and filtering
      // the row would delete a real registration on a word we have never
      // seen Workday use.
      expect(result.matched).toBe(1);
      expect(
        await db.enrollment.count({
          where: { userId: ownerId, courseId: otherCourseId, termId: otherTermId },
        }),
      ).toBe(1);
    } finally {
      logged.mockRestore();
    }
  });

  it('says nothing about a plain Registered status', async () => {
    const result = await importExport(ownerId, exportCovering('Registered'));
    expect(result.unexpectedStatuses).toEqual([]);
  });
});
