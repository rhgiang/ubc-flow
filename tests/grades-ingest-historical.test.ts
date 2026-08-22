import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { db } from '@/lib/db';
import { historicalGradesUrl, fetchHistoricalGrades } from '@/grades/jobs/ingest-historical';

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
