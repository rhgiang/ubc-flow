import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '@/lib/db';
import { gradeCsvUrl, ingestRows } from '@/grades/jobs/ingest';
import type { RawGradeRow } from '@/grades/parse-csv';

let courseId: string;
let subjectCode: string;
let courseNumber: string;
let instructorSlug: string;
let instructorName: string;

beforeAll(async () => {
  const course = await db.course.findFirstOrThrow({
    where: { subject: { code: { not: null } } },
    include: { subject: true },
  });
  courseId = course.id;
  subjectCode = course.subject.code!;
  courseNumber = course.number;

  const instructor = await db.instructor.findFirstOrThrow();
  instructorSlug = instructor.slug;
  instructorName = instructor.name;

  await db.gradeDistribution.deleteMany({ where: { courseId } });
});

afterAll(async () => {
  await db.gradeDistribution.deleteMany({ where: { courseId } });
  await db.$disconnect();
});

function makeRow(over: Partial<RawGradeRow> = {}): RawGradeRow {
  return {
    campus: 'UBCV',
    year: 2025,
    session: 'W',
    subject: subjectCode,
    courseNumber,
    detail: null,
    sectionCode: '101',
    title: 'Test',
    professors: [],
    reported: 100,
    average: 75,
    median: 76,
    high: 99,
    low: 40,
    distribution: { '<50': 5 } as RawGradeRow['distribution'],
    ...over,
  };
}

describe('gradeCsvUrl', () => {
  it('builds the verified upstream path', () => {
    expect(gradeCsvUrl('2025W', 'CPSC')).toBe(
      'https://raw.githubusercontent.com/DonneyF/ubc-pair-grade-data/master/tableau-dashboard-v2/UBCV/2025W/UBCV-2025W-CPSC.csv',
    );
  });
});

describe('ingestRows', () => {
  it('writes a distribution for a known course', async () => {
    const r = await ingestRows([makeRow()]);
    expect(r.written).toBe(1);
    expect(await db.gradeDistribution.count({ where: { courseId } })).toBe(1);
  });

  it('is idempotent — re-ingesting updates rather than duplicating', async () => {
    await ingestRows([makeRow({ average: 80 })]);
    const found = await db.gradeDistribution.findMany({ where: { courseId } });
    expect(found).toHaveLength(1);
    expect(found[0].average).toBeCloseTo(80);
  });

  it('treats Detail as part of section identity', async () => {
    await ingestRows([makeRow({ detail: 'A' })]);
    // Same section code, different detail -> a distinct row, not an overwrite.
    expect(await db.gradeDistribution.count({ where: { courseId } })).toBe(2);
  });

  it('skips rows whose course is not in our catalogue, and counts them', async () => {
    const r = await ingestRows([makeRow({ subject: 'ZZNOPE', courseNumber: '999' })]);
    expect(r.written).toBe(0);
    expect(r.skippedNoCourse).toBe(1);
  });

  it('links a matching professor', async () => {
    await ingestRows([makeRow({ sectionCode: '900', professors: [instructorName] })]);
    const row = await db.gradeDistribution.findFirstOrThrow({
      where: { courseId, sectionCode: '900' },
      include: { instructors: true },
    });
    expect(row.instructors).toHaveLength(1);
  });

  it('links EVERY professor of a co-taught section', async () => {
    const r = await ingestRows([
      makeRow({ sectionCode: '901', professors: [instructorName, 'Nobody McNobody'] }),
    ]);
    const row = await db.gradeDistribution.findFirstOrThrow({
      where: { courseId, sectionCode: '901' },
      include: { instructors: true },
    });
    // One matched, one didn't — the distribution is still written once.
    expect(row.instructors).toHaveLength(1);
    expect(r.unmatchedProfessors).toContain('Nobody McNobody');
  });

  it('still writes the distribution when no professor matches', async () => {
    const r = await ingestRows([
      makeRow({ sectionCode: '902', professors: ['Totally Unknown Person'] }),
    ]);
    expect(r.written).toBe(1);
    const row = await db.gradeDistribution.findFirstOrThrow({
      where: { courseId, sectionCode: '902' },
      include: { instructors: true },
    });
    expect(row.instructors).toHaveLength(0);
  });

  it('stores suppressed buckets as null, not zero', async () => {
    await ingestRows([
      makeRow({
        sectionCode: '903',
        distribution: { '<50': null, '90-100': 4 } as RawGradeRow['distribution'],
      }),
    ]);
    const row = await db.gradeDistribution.findFirstOrThrow({
      where: { courseId, sectionCode: '903' },
    });
    const dist = row.distribution as Record<string, number | null>;
    expect(dist['<50']).toBeNull();
    expect(dist['90-100']).toBe(4);
  });
});
