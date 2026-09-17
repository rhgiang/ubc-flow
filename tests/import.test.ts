import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { db } from '@/lib/db';
import { importExport } from '@/upload/import';
import type { ParsedExport, EnrollmentRow } from '@/upload/parse-workday';

const A = 'zz-import-a@example.com';
const B = 'zz-import-b@example.com';
const C = 'zz-import-c@example.com';
let userA: string;
let userB: string;
let userC: string;

// Columns the parser carries but importExport doesn't persist (no display
// use for them yet - see EnrollmentMeeting in schema.prisma).
const unusedColumns = {
  floor: null,
  meetingEndDate: null,
  credits: null,
  registrationStatus: null,
  deliveryMode: null,
};

const parsed: ParsedExport = {
  studentNumber: '99999999',
  transfers: [],
  rows: [
    {
      grade: null,
      status: 'registered' as const,
      subjectCode: 'CPSC',
      campus: 'V',
      courseNumber: '110',
      sectionCode: '103',
      activity: 'Lecture',
      building: 'HENN',
      room: '202',
      startDate: '2026-09-08',
      days: ['Mon', 'Wed', 'Fri'],
      meetingStartTime: '10:00',
      meetingEndTime: '11:00',
      instructor: 'Nick Bradley',
      sectionStartDate: '2026-09-08',
      sectionEndDate: '2026-12-07',
      termYear: 2026,
      termSession: 'W',
      termNumber: 1,
      ...unusedColumns,
    },
    {
      grade: null,
      status: 'registered' as const,
      subjectCode: 'ZZNOPE',
      campus: 'V',
      courseNumber: '999',
      sectionCode: null,
      activity: null,
      building: null,
      room: null,
      startDate: '2026-09-08',
      days: [],
      meetingStartTime: null,
      meetingEndTime: null,
      instructor: null,
      sectionStartDate: null,
      sectionEndDate: null,
      termYear: 2026,
      termSession: 'W',
      termNumber: 1,
      ...unusedColumns,
    },
  ],
  excluded: [{ raw: 'MATH_V 101 - Integral Calculus', reason: 'transfer_credit' }],
  unparsedTables: [],
};

beforeAll(async () => {
  process.env.SERVER_SECRET ??= 'test-secret';
  await db.user.deleteMany({ where: { email: { in: [A, B, C] } } });
  userA = (await db.user.create({ data: { email: A } })).id;
  userB = (await db.user.create({ data: { email: B } })).id;
  userC = (await db.user.create({ data: { email: C } })).id;
});

afterAll(async () => {
  await db.enrollment.deleteMany({ where: { userId: { in: [userA, userB, userC] } } });
  await db.enrollmentMeeting.deleteMany({ where: { userId: { in: [userA, userB, userC] } } });
  await db.user.deleteMany({ where: { email: { in: [A, B, C] } } });
  await db.$disconnect();
});

describe('importExport', () => {
  it('matches a real course and reports the unmatched one', async () => {
    const r = await importExport(userA, parsed);
    expect(r.matched).toBe(1);
    expect(r.unmatched).toContain('ZZNOPE 999');
    expect(r.excluded).toEqual([
      { raw: 'MATH_V 101 - Integral Calculus', reason: 'Transfer credit, earned at another institution' },
    ]);
  });

  it('writes a verified enrollment for the matched course', async () => {
    const rows = await db.enrollment.findMany({ where: { userId: userA } });
    expect(rows).toHaveLength(1);
    expect(rows[0].verified).toBe(true);
    expect(rows[0].source).toBe('workday');
  });

  it('binds the student number to the account and marks it verified', async () => {
    const u = await db.user.findUniqueOrThrow({ where: { id: userA } });
    expect(u.studentIdHash).toMatch(/^[0-9a-f]{64}$/);
    expect(u.verifiedAt).toBeTruthy();
  });

  it('never stores the raw student number', async () => {
    const u = await db.user.findUniqueOrThrow({ where: { id: userA } });
    expect(u.studentIdHash).not.toContain('99999999');
  });

  it('is idempotent - re-importing does not duplicate enrollments', async () => {
    await importExport(userA, parsed);
    expect(await db.enrollment.count({ where: { userId: userA } })).toBe(1);
  });

  it('writes the meeting pattern for the matched course, replacing on re-import', async () => {
    const rows = await db.enrollmentMeeting.findMany({ where: { userId: userA } });
    expect(rows).toHaveLength(1);
    expect(rows[0].days).toEqual(['Mon', 'Wed', 'Fri']);
    expect(rows[0].startTime).toBe('10:00');
    expect(rows[0].endTime).toBe('11:00');
    expect(rows[0].building).toBe('HENN');
    expect(rows[0].room).toBe('202');
    expect(rows[0].instructor).toBe('Nick Bradley');
    expect(rows[0].startDate?.toISOString().slice(0, 10)).toBe('2026-09-08');
    expect(rows[0].endDate?.toISOString().slice(0, 10)).toBe('2026-12-07');
  });

  it('refuses to bind the same student number to a second account', async () => {
    await expect(importExport(userB, parsed)).rejects.toThrow(/already/i);
    expect(await db.enrollment.count({ where: { userId: userB } })).toBe(0);
  });

  it('drops a course that is no longer in a re-uploaded term, meetings and all', async () => {
    // Any other catalogued CPSC course stands in for "the student swapped
    // one course for another" - the row's shape is what matters, not which.
    const other = await db.course.findFirstOrThrow({
      where: { subject: { code: 'CPSC', campus: 'V' }, number: { not: '110' } },
      select: { id: true, number: true },
    });
    const swapped: ParsedExport = {
      ...parsed,
      rows: [{ ...parsed.rows[0], courseNumber: other.number }],
    };

    const r = await importExport(userA, swapped);
    expect(r.matched).toBe(1);
    expect(r.removed).toBe(1);

    const rows = await db.enrollment.findMany({ where: { userId: userA } });
    expect(rows.map((e) => e.courseId)).toEqual([other.id]);
    const meetings = await db.enrollmentMeeting.findMany({ where: { userId: userA } });
    expect(meetings.map((m) => m.courseId)).toEqual([other.id]);
  });

  it('refuses to rebind an already-verified account to a different, unclaimed student number', async () => {
    const first: ParsedExport = {
      studentNumber: '11111111',
      rows: [],
      transfers: [],
      excluded: [],
      unparsedTables: [],
    };
    const r1 = await importExport(userC, first);
    expect(r1.boundStudent).toBe(true);

    const bound = await db.user.findUniqueOrThrow({ where: { id: userC } });
    expect(bound.studentIdHash).toMatch(/^[0-9a-f]{64}$/);

    const second: ParsedExport = {
      studentNumber: '22222222',
      rows: [],
      transfers: [],
      excluded: [],
      unparsedTables: [],
    };
    await expect(importExport(userC, second)).rejects.toThrow(/already linked to a different/i);

    // The digest must be UNCHANGED after the rejected rebind attempt - not
    // silently overwritten with the second student's identity.
    const after = await db.user.findUniqueOrThrow({ where: { id: userC } });
    expect(after.studentIdHash).toBe(bound.studentIdHash);
  });
});

// A lecture and a lab of one course, the shape of the export that lost a lab:
// the lab row is a registered section with a Start Date, so it passes the term
// check and is counted, and its Meeting Patterns cell gave the parser nothing.
describe('importExport - sections it could not place', () => {
  const EMAIL = 'zz-import-unplaced@example.com';
  let userId: string;
  const base = {
    grade: null,
    status: 'registered' as const,
    subjectCode: 'CPSC',
    campus: 'V',
    courseNumber: '110',
    instructor: null,
    sectionStartDate: '2026-09-08',
    sectionEndDate: '2026-12-07',
    termYear: 2026,
    termSession: 'W',
    termNumber: 1,
    ...unusedColumns,
  };
  const lecture = (): EnrollmentRow => ({
    ...base,
    sectionCode: '103',
    activity: 'Lecture',
    building: 'HENN',
    room: '202',
    startDate: '2026-09-08',
    days: ['Tue', 'Thu'],
    meetingStartTime: '15:30',
    meetingEndTime: '17:00',
  });
  const lab = (over: Partial<EnrollmentRow> = {}): EnrollmentRow => ({
    ...base,
    sectionCode: 'L1U',
    activity: 'Laboratory',
    building: 'ICCS',
    room: 'X260',
    startDate: '2026-09-10',
    days: ['Thu'],
    meetingStartTime: '09:00',
    meetingEndTime: '12:00',
    ...over,
  });
  const exportOf = (rows: EnrollmentRow[]): ParsedExport => ({
    studentNumber: null,
    rows,
    transfers: [],
    excluded: [],
    unparsedTables: [],
  });
  const sectionsWithMeetings = async () =>
    (await db.enrollmentMeeting.findMany({ where: { userId }, orderBy: { sectionCode: 'asc' } })).map(
      (m) => m.sectionCode,
    );

  beforeAll(async () => {
    await db.user.deleteMany({ where: { email: EMAIL } });
    userId = (await db.user.create({ data: { email: EMAIL } })).id;
  });

  afterAll(async () => {
    await db.enrollment.deleteMany({ where: { userId } });
    await db.enrollmentMeeting.deleteMany({ where: { userId } });
    await db.user.deleteMany({ where: { email: EMAIL } });
  });

  it('names a lab with no meeting day, and still counts it and writes no meeting for it', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const r = await importExport(
        userId,
        exportOf([lecture(), lab({ days: [], meetingStartTime: null, meetingEndTime: null, unparsedMeeting: 'To be determined' })]),
      );
      expect(r.matched).toBe(2);
      expect(r.unmatched).toEqual([]);
      expect(r.unplaced).toEqual(['CPSC 110 L1U']);
      // What is written is unchanged: the lecture's meeting, and nothing for the lab.
      expect(await sectionsWithMeetings()).toEqual(['103']);
      // The segments that failed to parse reach the log, column values only.
      expect(logged.mock.calls.map((c) => c.join(' ')).join('\n')).toContain('To be determined');
    } finally {
      logged.mockRestore();
    }
  });

  it('names a lab whose time did not parse, which is written with null times', async () => {
    const r = await importExport(userId, exportOf([lecture(), lab({ meetingStartTime: null, meetingEndTime: null })]));
    expect(r.unplaced).toEqual(['CPSC 110 L1U']);
    expect(await sectionsWithMeetings()).toEqual(['103', 'L1U']);
  });

  it('falls back to the activity when the section code is missing', async () => {
    const r = await importExport(userId, exportOf([lecture(), lab({ sectionCode: null, days: [] })]));
    expect(r.unplaced).toEqual(['CPSC 110 Laboratory']);
  });

  it('names nothing when every section has a day and a time', async () => {
    const r = await importExport(userId, exportOf([lecture(), lab()]));
    expect(r.unplaced).toEqual([]);
    expect(await sectionsWithMeetings()).toEqual(['103', 'L1U']);
  });

  it('passes through the tables the parser did not read, so the form can say so', async () => {
    const r = await importExport(userId, {
      ...exportOf([lecture()]),
      unparsedTables: ['Course Listing | Section | Meeting Patterns'],
    });
    expect(r.unparsedTables).toEqual(['Course Listing | Section | Meeting Patterns']);
    expect(r.matched).toBe(1);
  });

  it('says nothing about an academic-record row, which has no pattern by design', async () => {
    const r = await importExport(
      userId,
      exportOf([{ ...lecture(), days: [], meetingStartTime: null, meetingEndTime: null, termYear: null, termSession: null, termNumber: null }]),
    );
    expect(r.unplaced).toEqual([]);
  });
});
