import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '@/lib/db';
import { upsertSections } from '@/scrape/jobs/sections';
import type { RawSection } from '@/scrape/parse-nodes';

const rows: RawSection[] = [
  {
    sectionCode: '101',
    activity: 'Lecture',
    status: 'Open',
    deliveryMode: 'In person',
    instructorNames: ['John Smith'],
    meetings: [
      { day: 'Mon', startTime: '14:00', endTime: '15:00', building: null, room: null, startDate: new Date('2026-09-08'), endDate: new Date('2026-12-05') },
      { day: 'Wed', startTime: '14:00', endTime: '15:00', building: null, room: null, startDate: new Date('2026-09-08'), endDate: new Date('2026-12-05') },
    ],
    course: {
      subjectCode: 'ZZTEST',
      campus: 'V',
      number: '101',
      title: 'Test Course',
      credits: 3,
      bodyHtml: '<p>A test course.</p>',
      ubcSubjectId: 'ZZTEST-SUBJ',
    },
  },
];

describe('upsertSections', () => {
  let termId: string;

  beforeAll(async () => {
    await db.subject.upsert({
      where: { ubcSubjectId_campus: { ubcSubjectId: 'ZZTEST-SUBJ', campus: 'V' } },
      create: { ubcSubjectId: 'ZZTEST-SUBJ', name: 'Test Subject', campus: 'V', code: 'ZZTEST' },
      update: { code: 'ZZTEST' },
    });
    const term = await db.term.upsert({
      where: { ubcPeriodId: 'ZZTEST-PERIOD' },
      create: {
        ubcPeriodId: 'ZZTEST-PERIOD',
        name: 'Test Term',
        year: 2026,
        session: 'W',
        termNumber: 1,
        campus: 'V',
      },
      update: {},
    });
    termId = term.id;
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  it('is idempotent across repeated runs', async () => {
    await upsertSections(rows, termId);
    const secondRunWritten = await upsertSections(rows, termId);
    expect(secondRunWritten).toBe(1);

    const subject = await db.subject.findUniqueOrThrow({
      where: { ubcSubjectId_campus: { ubcSubjectId: 'ZZTEST-SUBJ', campus: 'V' } },
    });
    expect(await db.course.count({ where: { subjectId: subject.id } })).toBe(1);
    expect(await db.section.count({ where: { termId } })).toBe(1);

    const section = await db.section.findFirstOrThrow({ where: { termId } });
    expect(await db.meetingTime.count({ where: { sectionId: section.id } })).toBe(2);
    expect(await db.sectionInstructor.count({ where: { sectionId: section.id } })).toBe(1);
    expect(await db.instructor.count({ where: { slug: 'john-smith' } })).toBe(1);
  });

  it('updates a changed section in place rather than duplicating it', async () => {
    await upsertSections(
      [{ ...rows[0], status: 'Waitlist', meetings: [rows[0].meetings[0]] }],
      termId,
    );

    expect(await db.section.count({ where: { termId } })).toBe(1);
    const section = await db.section.findFirstOrThrow({ where: { termId } });
    expect(section.status).toBe('Waitlist');
    // Meetings are replaced wholesale, so the dropped day must be gone.
    expect(await db.meetingTime.count({ where: { sectionId: section.id } })).toBe(1);
  });

  it('skips a section whose course failed to parse', async () => {
    const before = await db.section.count({ where: { termId } });
    const written = await upsertSections([{ ...rows[0], sectionCode: '999', course: null }], termId);
    expect(written).toBe(0);
    expect(await db.section.count({ where: { termId } })).toBe(before);
  });

  // Guards against the exact silent-failure mode the safety guard exists to catch: a row
  // that PARSES fine (course present, right campus, sectionCode present) but whose
  // ubcSubjectId matches no Subject row in the DB — e.g. if UBC ever renamed the
  // field_subject relationship. Without this returning 0, scrapeSections would log a
  // "success" while writing nothing.
  it('returns 0 for a parsed row whose subject cannot be resolved in the DB', async () => {
    const before = await db.section.count({ where: { termId } });
    const written = await upsertSections(
      [
        {
          ...rows[0],
          sectionCode: '888',
          course: { ...rows[0].course!, ubcSubjectId: 'NO-SUCH-SUBJECT-ID' },
        },
      ],
      termId,
    );
    expect(written).toBe(0);
    expect(await db.section.count({ where: { termId } })).toBe(before);
  });
});
