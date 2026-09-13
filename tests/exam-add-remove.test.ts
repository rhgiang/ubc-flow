import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '@/lib/db';
import {
  withoutHidden,
  examRowsForUser,
  syllabusExamRowsForUser,
  hiddenExamRowsForUser,
  mergeExams,
  type ExamListItem,
} from '@/schedule/exams';
import { examCalendar } from '@/schedule/exam-calendar';
import { normalizeManualExam, normalizeSavedAssessment } from '@/syllabus/schema';

const scraped: ExamListItem = {
  id: 'ubc-1', courseLabel: 'BIOC 302', sectionCode: '951', kind: 'final',
  date: new Date('2026-12-15T00:00:00Z'), startTime: '12:00',
  location: 'BIOL 1000', alphaSplit: null, notes: null,
  cancelled: false, source: 'ubc',
};
const mine: ExamListItem = {
  ...scraped, id: 'ubc-1', courseLabel: 'MATH 101', kind: 'midterm',
  source: 'syllabus', editedByUser: true, location: null,
};

describe('withoutHidden', () => {
  it('drops the scraped rows this student hid, and nothing else', () => {
    const other = { ...scraped, id: 'ubc-2', courseLabel: 'MATH 101' };
    const out = withoutHidden([scraped, other], new Set(['ubc-1']));
    expect(out.map((i) => i.id)).toEqual(['ubc-2']);
  });

  it('never touches a syllabus row, which is deleted rather than hidden', () => {
    // Same id, different source: only the scraped one is hideable.
    const out = withoutHidden([scraped, mine], new Set(['ubc-1']));
    expect(out).toEqual([mine]);
  });

  it('restores everything once the marker is gone', () => {
    expect(withoutHidden([scraped, mine], new Set())).toEqual([scraped, mine]);
  });

  it('keeps a hidden exam out of both views and out of the feed', () => {
    // One filtered list feeds all three: the list, the calendar grid, and the
    // merged list the ICS route walks.
    const visible = withoutHidden([scraped], new Set(['ubc-1']));
    expect(mergeExams(visible, [])).toEqual([]);
    const { months, unscheduled } = examCalendar(visible);
    expect(months).toEqual([]);
    expect(unscheduled).toEqual([]);
  });
});

describe('normalizeManualExam', () => {
  const typed = { kind: 'midterm', date: '2026-10-14', startTime: '18:00', weight: 20 };

  it('saves a typed exam with no quote, because the student is the evidence', () => {
    expect(normalizeManualExam(typed)).toEqual({
      title: 'Midterm', kind: 'midterm', date: '2026-10-14', startTime: '18:00',
      weight: 20, quote: null, page: null, editedByUser: true, location: null,
    });
  });

  it('still drops an extracted row with no quote', () => {
    expect(normalizeSavedAssessment({ ...typed, title: 'Midterm 1', quote: '', page: 3 })).toBeNull();
  });

  it('names a final a final', () => {
    expect(normalizeManualExam({ ...typed, kind: 'final' })?.title).toBe('Final exam');
  });

  it('validates kind, and takes only the two that belong on an exam page', () => {
    expect(normalizeManualExam({ ...typed, kind: 'participation' })).toBeNull();
    expect(normalizeManualExam({ ...typed, kind: 'assignment' })).toBeNull();
    expect(normalizeManualExam({ ...typed, kind: 'quiz' })).toBeNull();
  });

  it('keeps the optional fields optional, and a junk date is no date', () => {
    const row = normalizeManualExam({ kind: 'final', date: 'next tuesday' });
    expect(row).toMatchObject({ date: null, startTime: null, weight: null, location: null });
  });

  it('trims the location the student typed', () => {
    expect(normalizeManualExam({ ...typed, location: '  BUCH A101 ' })?.location).toBe('BUCH A101');
  });
});

// Rows a student added themselves, and the hidden marker, against the real
// schema - the point being that neither needs a Syllabus row to exist.
const EMAIL = 'zz-exam-add-remove@example.com';
const OTHER = 'zz-exam-add-remove-other@example.com';
let userId: string;
let otherId: string;
let courseId: string;
let termId: string;
let finalExamId: string;

beforeAll(async () => {
  await db.user.deleteMany({ where: { email: { in: [EMAIL, OTHER] } } });
  userId = (await db.user.create({ data: { email: EMAIL } })).id;
  otherId = (await db.user.create({ data: { email: OTHER } })).id;

  courseId = (await db.course.findFirstOrThrow({ select: { id: true } })).id;
  termId = (await db.term.findFirstOrThrow({ select: { id: true } })).id;

  await db.enrollment.create({ data: { userId, courseId, termId, source: 'test' } });
  finalExamId = (
    await db.finalExam.create({
      data: {
        courseId, termId, sectionCode: 'ZZ-TEST',
        date: new Date('2026-12-15T00:00:00Z'), startTime: '12:00',
        building: 'BIOL', room: '1000',
      },
    })
  ).id;
});

afterAll(async () => {
  await db.finalExam.deleteMany({ where: { id: finalExamId } });
  await db.user.deleteMany({ where: { email: { in: [EMAIL, OTHER] } } });
  await db.$disconnect();
});

describe('an exam the student added, with no syllabus behind it', () => {
  it('belongs to them without a Syllabus row to hang off', async () => {
    const created = await db.syllabusAssessment.create({
      data: {
        syllabusId: null, userId, courseId, termId,
        title: 'Midterm', kind: 'midterm',
        date: new Date('2026-10-14T00:00:00Z'), startTime: '18:00',
        location: 'BUCH A101', quote: null, page: null, editedByUser: true,
      },
    });

    const rows = await syllabusExamRowsForUser(userId, termId);
    expect(rows.map((r) => r.id)).toContain(created.id);
    const row = rows.find((r) => r.id === created.id)!;
    expect(row.source).toBe('syllabus');
    expect(row.editedByUser).toBe(true);
    expect(row.location).toBe('BUCH A101');

    // Nobody else's exam, however many syllabi they have.
    expect(await syllabusExamRowsForUser(otherId, termId)).toEqual([]);

    await db.syllabusAssessment.delete({ where: { id: created.id } });
    expect((await syllabusExamRowsForUser(userId, termId)).map((r) => r.id))
      .not.toContain(created.id);
  });
});

describe('hiding a scraped exam', () => {
  it('takes it off this student\'s list and puts it back', async () => {
    const before = await examRowsForUser(userId, termId);
    expect(before.map((e) => e.id)).toContain(finalExamId);

    await db.hiddenFinalExam.create({ data: { userId, finalExamId } });
    const after = await examRowsForUser(userId, termId);
    expect(after.map((e) => e.id)).not.toContain(finalExamId);

    // And it is findable again, which is the whole reason hiding is a marker.
    const hidden = await hiddenExamRowsForUser(userId, termId);
    expect(hidden.map((e) => e.id)).toEqual([finalExamId]);

    await db.hiddenFinalExam.deleteMany({ where: { userId, finalExamId } });
    expect((await examRowsForUser(userId, termId)).map((e) => e.id)).toContain(finalExamId);
    expect(await hiddenExamRowsForUser(userId, termId)).toEqual([]);
  });

  it('leaves the row alone for everyone else in the course', async () => {
    await db.hiddenFinalExam.create({ data: { userId, finalExamId } });
    // The global row is untouched: hiding is per student, never a delete.
    expect(await db.finalExam.findUnique({ where: { id: finalExamId } })).not.toBeNull();
    await db.hiddenFinalExam.deleteMany({ where: { userId, finalExamId } });
  });
});
