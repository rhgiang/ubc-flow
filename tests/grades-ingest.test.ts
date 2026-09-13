import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '@/lib/db';
import { gradeCsvUrl, ingestRows, SESSIONS, V1_SESSIONS } from '@/grades/jobs/ingest';
import type { RawGradeRow } from '@/grades/parse-csv';

// A dedicated fixture course, NOT a real one. This suite deletes every
// GradeDistribution row for whatever course it targets, so pointing it at the
// catalogue (findFirstOrThrow) meant each run destroyed a real course's grade
// history - POLI 351 lost all 9 of its rows this way.
const SUBJECT_CODE = 'ZZGRD';
const SUBJECT_UBC_ID = 'ZZGRD-SUBJ';
const COURSE_NUMBER = '999';
const INSTRUCTOR_NAME = 'Zz Gradetest';
const INSTRUCTOR_SLUG = 'zz-gradetest';

let courseId: string;
let subjectId: string;
const subjectCode = SUBJECT_CODE;
const courseNumber = COURSE_NUMBER;
const instructorName = INSTRUCTOR_NAME;

beforeAll(async () => {
  const subject = await db.subject.upsert({
    where: { ubcSubjectId_campus: { ubcSubjectId: SUBJECT_UBC_ID, campus: 'V' } },
    create: {
      ubcSubjectId: SUBJECT_UBC_ID,
      name: 'Grade Ingest Fixture',
      campus: 'V',
      code: SUBJECT_CODE,
    },
    update: { code: SUBJECT_CODE },
  });
  subjectId = subject.id;

  const course = await db.course.upsert({
    where: { subjectId_number: { subjectId: subject.id, number: COURSE_NUMBER } },
    create: {
      subjectId: subject.id,
      number: COURSE_NUMBER,
      title: 'Grade Ingest Fixture',
      campus: 'V',
    },
    update: {},
  });
  courseId = course.id;

  await db.instructor.upsert({
    where: { slug: INSTRUCTOR_SLUG },
    create: { name: INSTRUCTOR_NAME, slug: INSTRUCTOR_SLUG, campus: 'V' },
    update: {},
  });

  await db.gradeDistribution.deleteMany({ where: { courseId } });
});

afterAll(async () => {
  // GradeDistribution (and its instructor links) cascade from the course.
  await db.course.deleteMany({ where: { id: courseId } });
  await db.subject.deleteMany({ where: { id: subjectId } });
  await db.instructor.deleteMany({ where: { slug: INSTRUCTOR_SLUG } });
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

  it('routes a pre-2021 session to the v1 export directory', () => {
    expect(gradeCsvUrl('2016W', 'CPSC')).toBe(
      'https://raw.githubusercontent.com/DonneyF/ubc-pair-grade-data/master/tableau-dashboard/UBCV/2016W/UBCV-2016W-CPSC.csv',
    );
  });

  it('takes 2021, which exists in both exports, from v2 only', () => {
    // Ingesting 2021 from both would double every section's students.
    expect(gradeCsvUrl('2021W', 'CPSC')).toContain('tableau-dashboard-v2');
    expect(V1_SESSIONS as readonly string[]).not.toContain('2021W');
    expect(V1_SESSIONS as readonly string[]).not.toContain('2021S');
  });

  it('covers every session from 2014S through 2025W exactly once', () => {
    expect(SESSIONS).toHaveLength(24);
    expect(new Set(SESSIONS).size).toBe(24);
    expect(SESSIONS[0]).toBe('2014S');
    expect(SESSIONS[SESSIONS.length - 1]).toBe('2025W');
  });
});

describe('ingestRows', () => {
  it('writes a distribution for a known course', async () => {
    const r = await ingestRows([makeRow()]);
    expect(r.written).toBe(1);
    expect(await db.gradeDistribution.count({ where: { courseId } })).toBe(1);
  });

  it('is idempotent - re-ingesting updates rather than duplicating', async () => {
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

  it('keeps distinct years separate even when neither matches a real Term', async () => {
    // Our Term catalogue only covers current/near-term periods, so historical
    // grade-data years (e.g. 2021, 2022) never resolve to a real term. Both
    // rows share course+section+detail; only the year differs. If the
    // unmatched-term sentinel doesn't encode the year, the second upsert
    // would silently overwrite the first (the exact bug found during the
    // real Task 6 ingest, where 2021-2024 grades collided into single rows).
    await ingestRows([makeRow({ sectionCode: '950', year: 2021, average: 55 })]);
    await ingestRows([makeRow({ sectionCode: '950', year: 2022, average: 91 })]);
    const found = await db.gradeDistribution.findMany({
      where: { courseId, sectionCode: '950' },
      orderBy: { average: 'asc' },
    });
    expect(found).toHaveLength(2);
    expect(found[0].average).toBeCloseTo(55);
    expect(found[1].average).toBeCloseTo(91);
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
    // One matched, one didn't - the distribution is still written once.
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

  it('skips the v1 export\'s OVERALL rollup rather than storing it as a section', async () => {
    // The pre-2021 files carry one OVERALL row per course whose count is the
    // sum of its real sections. Stored as a section it would double the
    // course's students and every distribution bucket.
    const r = await ingestRows([makeRow({ sectionCode: 'OVERALL', reported: 999 })]);
    expect(r.written).toBe(0);
    expect(
      await db.gradeDistribution.count({ where: { courseId, sectionCode: 'OVERALL' } }),
    ).toBe(0);
  });

  it('links a professor once when one row names them under two spellings', async () => {
    // Real 2015S data: SPAN 102 lists "Brianne Orr Alvarez" and
    // "Brianne Orr-Alvarez" on the same row. Both normalize to one slug, so
    // linking per raw name violates GradeDistributionInstructor's
    // (distributionId, instructorId) primary key and aborts the ingest.
    const spaced = instructorName;
    const hyphenated = instructorName.replace(/\s+/g, '-');
    const r = await ingestRows([
      makeRow({ sectionCode: '904', professors: [spaced, hyphenated] }),
    ]);
    expect(r.written).toBe(1);
    const row = await db.gradeDistribution.findFirstOrThrow({
      where: { courseId, sectionCode: '904' },
      include: { instructors: true },
    });
    expect(row.instructors).toHaveLength(1);
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
