import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { db } from '@/lib/db';
import {
  historicalGradesUrl,
  historicalGradesDistributionsUrl,
  fetchHistoricalGrades,
  fetchHistoricalGradesByTerm,
  averageFromBuckets,
} from '@/grades/jobs/ingest-historical';

afterAll(async () => {
  await db.$disconnect();
});

beforeEach(() => vi.restoreAllMocks());

// Real UBCGrades API responses, captured live during spec research (plan
// doc) and re-confirmed live during this fix pass — see
// docs/superpowers/plans/2026-08-22-course-professor-pages.md.
const CPSC_110_RESPONSE = {
  average: 74.32815216682194,
  average_past_5_yrs: 74.93280888477317,
  campus: 'UBCV',
  course: '110',
  course_title: 'Computation, Programs, and Programming',
  detail: '',
  faculty_title: 'Faculty of Science',
  max_course_avg: 91,
  min_course_avg: 64.06626506,
  stdev: 19.163549407185215,
  subject: 'CPSC',
  subject_title: 'Computer Science',
};

// BAEN 507 has too little history for a 5-year average, so the API returns
// average_past_5_yrs: "" (a string) instead of a number.
const BAEN_507_RESPONSE = {
  average: 81.61513369029412,
  average_past_5_yrs: '',
  campus: 'UBCV',
  course: '507',
  course_title: 'Entrepreneurship Technology and Non-Technology Streams II',
  detail: '',
  faculty_title: 'Faculty of Commerce and Business Administration',
  max_course_avg: 85.36,
  min_course_avg: 76.96,
  stdev: 8.634452227189085,
  subject: 'BAEN',
  subject_title: 'Business Administration: Entrepreneurship',
};

describe('historicalGradesUrl', () => {
  it('builds the verified real endpoint', () => {
    expect(historicalGradesUrl('UBCV', 'CPSC', '110')).toBe(
      'https://ubcgrades.com/api/v2/course-statistics/UBCV/CPSC/110',
    );
  });
});

describe('fetchHistoricalGrades', () => {
  it('returns real stats for a course with grade history', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(CPSC_110_RESPONSE), { status: 200 }),
    );
    const result = await fetchHistoricalGrades('CPSC', '110');
    expect(result).not.toBeNull();
    expect(result!.average).toBeGreaterThan(0);
    expect(result!.average).toBeLessThanOrEqual(100);
    expect(result!.average_past_5_yrs).toBeGreaterThan(0);
  });

  it('returns null for a course with no grade history, not an error', async () => {
    // Real 404 confirmed live during spec research.
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('Not Found', { status: 404 }));
    const result = await fetchHistoricalGrades('ZZZZ', '999');
    expect(result).toBeNull();
  });

  it('coerces a non-numeric field to null instead of returning "" or throwing', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(BAEN_507_RESPONSE), { status: 200 }),
    );
    const result = await fetchHistoricalGrades('BAEN', '507');
    expect(result).not.toBeNull();
    expect(result!.average_past_5_yrs).toBeNull();
    expect(result!.average).toBeGreaterThan(0);
  });
});

describe('historicalGradesDistributionsUrl', () => {
  it('builds the verified real distributions endpoint', () => {
    expect(historicalGradesDistributionsUrl('UBCV', 'CPSC', '110')).toBe(
      'https://ubcgrades.com/api/v2/course-statistics/distributions/UBCV/CPSC/110',
    );
  });
});

describe('averageFromBuckets', () => {
  it('uses the granular sub-50 buckets and ignores the redundant "<50%" rollup when both are present', () => {
    // Real CPSC 110 W2009 entry — "<50%": 8 exactly equals the sum of the
    // five granular sub-50 buckets (1+1+1+2+3), confirming it's a redundant
    // rollup here, not additional students.
    const grades = {
      '0-9%': 1,
      '10-19%': 1,
      '20-29%': 1,
      '30-39%': 2,
      '40-49%': 3,
      '50-54%': 5,
      '55-59%': 4,
      '60-63%': 2,
      '64-67%': 7,
      '68-71%': 3,
      '72-75%': 4,
      '76-79%': 8,
      '80-84%': 7,
      '85-89%': 6,
      '90-100%': 20,
      '<50%': 8,
    };
    expect(averageFromBuckets(grades)).toBeCloseTo(73.43, 1);
  });

  it('falls back to the "<50%" rollup when the granular sub-50 buckets are all null', () => {
    // Real CPSC 110 W2014 entry — UBC stopped reporting the granular
    // sub-50 breakdown; only "<50%" has a real count.
    const grades = {
      '0-9%': null,
      '10-19%': null,
      '20-29%': null,
      '30-39%': null,
      '40-49%': null,
      '50-54%': 3,
      '55-59%': 6,
      '60-63%': 9,
      '64-67%': 6,
      '68-71%': 9,
      '72-75%': 13,
      '76-79%': 18,
      '80-84%': 21,
      '85-89%': 23,
      '90-100%': 37,
      '<50%': 17,
    };
    expect(averageFromBuckets(grades)).toBeCloseTo(74.59, 1);
  });

  it('ignores a bucket returned as "" instead of a number', () => {
    // Real COMM 202 2015W entry: the API emits "" for the 50-54% bucket.
    // Treating "" as a count turns the running total into a string via
    // `count += ""`, so every later += concatenates and the result comes out
    // as ~8e-19 rather than a grade. Must land in the normal 70s-80s range.
    const grades = {
      '0-9%': null,
      '10-19%': null,
      '20-29%': null,
      '30-39%': null,
      '40-49%': null,
      '50-54%': '',
      '55-59%': 9,
      '60-63%': 23,
      '64-67%': 46,
      '68-71%': 58,
      '72-75%': 102,
      '76-79%': 119,
      '80-84%': 160,
      '85-89%': 192,
      '90-100%': 190,
      '<50%': 6,
    };
    const avg = averageFromBuckets(grades);
    expect(avg).not.toBeNull();
    expect(avg!).toBeGreaterThan(70);
    expect(avg!).toBeLessThan(90);
  });

  it('returns null when every bucket is null', () => {
    const grades = Object.fromEntries(
      ['0-9%', '10-19%', '20-29%', '30-39%', '40-49%', '50-54%', '<50%'].map((b) => [b, null]),
    );
    expect(averageFromBuckets(grades)).toBeNull();
  });
});

describe('fetchHistoricalGradesByTerm', () => {
  it('computes one average per term from the real distributions response shape', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify([
          {
            campus: 'UBCV',
            course: '110',
            detail: '',
            grades: {
              '0-9%': 1,
              '10-19%': 1,
              '20-29%': 1,
              '30-39%': 2,
              '40-49%': 3,
              '50-54%': 5,
              '55-59%': 4,
              '60-63%': 2,
              '64-67%': 7,
              '68-71%': 3,
              '72-75%': 4,
              '76-79%': 8,
              '80-84%': 7,
              '85-89%': 6,
              '90-100%': 20,
              '<50%': 8,
            },
            session: 'W',
            subject: 'CPSC',
            year: '2009',
          },
        ]),
        { status: 200 },
      ),
    );
    const result = await fetchHistoricalGradesByTerm('CPSC', '110');
    expect(result).toEqual([{ year: 2009, session: 'W', average: expect.any(Number) }]);
    expect(result[0].average).toBeCloseTo(73.43, 1);
  });

  it('returns an empty array for a course with no distribution history, not an error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('Not Found', { status: 404 }));
    const result = await fetchHistoricalGradesByTerm('ZZZZ', '999');
    expect(result).toEqual([]);
  });
});
