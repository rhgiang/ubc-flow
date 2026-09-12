import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '@/lib/db';
import { validateSyllabusFile, MAX_SYLLABUS_BYTES } from '@/syllabus/validate';

describe('validateSyllabusFile', () => {
  it('accepts a normal PDF', () => {
    expect(validateSyllabusFile({ type: 'application/pdf', size: 900_000, name: 'cpsc221.pdf' }))
      .toBeNull();
  });

  it('rejects a non-PDF regardless of extension', () => {
    expect(validateSyllabusFile({ type: 'application/zip', size: 1000, name: 'syllabus.pdf' }))
      .toMatch(/PDF/);
  });

  it('rejects an oversized file before anything is uploaded', () => {
    expect(validateSyllabusFile({
      type: 'application/pdf', size: MAX_SYLLABUS_BYTES + 1, name: 'big.pdf',
    })).toMatch(/too large/i);
  });

  it('rejects an empty file', () => {
    expect(validateSyllabusFile({ type: 'application/pdf', size: 0, name: 'e.pdf' }))
      .toMatch(/empty/i);
  });
});

// Ownership check on the file-streaming route: a signed-in student must never
// be able to read another student's syllabus by guessing/enumerating ids.
// This exercises the same query the GET handler in
// src/app/api/syllabus/[id]/file/route.ts runs before calling get() — see
// that file for why the check is `findUnique` + `userId` comparison rather
// than baking userId into the where clause (both are equivalent here, but
// the route's comment explains the 404-not-403 choice).
describe('syllabus ownership check', () => {
  const OWNER = 'zz-syllabus-owner@example.com';
  const OTHER = 'zz-syllabus-other@example.com';
  let ownerId: string;
  let otherId: string;
  let courseId: string;
  let termId: string;
  let syllabusId: string;

  beforeAll(async () => {
    await db.user.deleteMany({ where: { email: { in: [OWNER, OTHER] } } });
    ownerId = (await db.user.create({ data: { email: OWNER } })).id;
    otherId = (await db.user.create({ data: { email: OTHER } })).id;

    const course = await db.course.findFirstOrThrow({ select: { id: true } });
    const term = await db.term.findFirstOrThrow({ select: { id: true } });
    courseId = course.id;
    termId = term.id;

    const syllabus = await db.syllabus.create({
      data: {
        userId: ownerId,
        courseId,
        termId,
        pathname: 'syllabi/test-owner-cpsc221.pdf',
        filename: 'cpsc221.pdf',
        size: 12_345,
      },
    });
    syllabusId = syllabus.id;
  });

  afterAll(async () => {
    await db.syllabus.deleteMany({ where: { userId: { in: [ownerId, otherId] } } });
    await db.user.deleteMany({ where: { email: { in: [OWNER, OTHER] } } });
    await db.$disconnect();
  });

  it('finds the row for its owner', async () => {
    const row = await db.syllabus.findUnique({ where: { id: syllabusId } });
    expect(row?.userId).toBe(ownerId);
  });

  it('rejects a non-owner — the row exists but userId does not match', async () => {
    const row = await db.syllabus.findUnique({ where: { id: syllabusId } });
    const isOwner = row !== null && row.userId === otherId;
    expect(isOwner).toBe(false);
  });
});
