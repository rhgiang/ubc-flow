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
      { day: 'Mon', startTime: '14:00', endTime: '15:00', building: null, room: null },
      { day: 'Wed', startTime: '14:00', endTime: '15:00', building: null, room: null },
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
    await upsertSections(rows, termId);

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
    await upsertSections([{ ...rows[0], sectionCode: '999', course: null }], termId);
    expect(await db.section.count({ where: { termId } })).toBe(before);
  });
});
