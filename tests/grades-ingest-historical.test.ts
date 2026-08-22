import { describe, it, expect, afterAll } from 'vitest';
import { db } from '@/lib/db';
import { historicalGradesUrl, fetchHistoricalGrades } from '@/grades/jobs/ingest-historical';

afterAll(async () => {
  await db.$disconnect();
});

describe('historicalGradesUrl', () => {
  it('builds the verified real endpoint', () => {
    expect(historicalGradesUrl('UBCV', 'CPSC', '110')).toBe(
      'https://ubcgrades.com/api/v2/course-statistics/UBCV/CPSC/110',
    );
  });
});

describe('fetchHistoricalGrades', () => {
  it('returns real stats for a course with grade history', async () => {
    const result = await fetchHistoricalGrades('CPSC', '110');
    expect(result).not.toBeNull();
    expect(result!.average).toBeGreaterThan(0);
    expect(result!.average).toBeLessThanOrEqual(100);
    expect(result!.average_past_5_yrs).toBeGreaterThan(0);
  });

  it('returns null for a course with no grade history, not an error', async () => {
    // Real 404 confirmed live during spec research.
    const result = await fetchHistoricalGrades('ZZZZ', '999');
    expect(result).toBeNull();
  });
});
