import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '@/lib/db';
import { importExport } from '@/upload/import';
import type { ParsedExport } from '@/upload/parse-workday';

const A = 'zz-import-a@example.com';
const B = 'zz-import-b@example.com';
const C = 'zz-import-c@example.com';
let userA: string;
let userB: string;
let userC: string;

const parsed: ParsedExport = {
  studentNumber: '99999999',
  rows: [
    {
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
      termYear: 2026,
      termSession: 'W',
      termNumber: 1,
    },
    {
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
      termYear: 2026,
      termSession: 'W',
      termNumber: 1,
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
    expect(r.excluded).toBe(1);
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

  it('is idempotent — re-importing does not duplicate enrollments', async () => {
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
  });

  it('refuses to bind the same student number to a second account', async () => {
    await expect(importExport(userB, parsed)).rejects.toThrow(/already/i);
    expect(await db.enrollment.count({ where: { userId: userB } })).toBe(0);
  });

  it('refuses to rebind an already-verified account to a different, unclaimed student number', async () => {
    const first: ParsedExport = {
      studentNumber: '11111111',
      rows: [],
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
      excluded: [],
      unparsedTables: [],
    };
    await expect(importExport(userC, second)).rejects.toThrow(/already linked to a different/i);

    // The digest must be UNCHANGED after the rejected rebind attempt — not
    // silently overwritten with the second student's identity.
    const after = await db.user.findUniqueOrThrow({ where: { id: userC } });
    expect(after.studentIdHash).toBe(bound.studentIdHash);
  });
});
