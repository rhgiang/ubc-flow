import { describe, it, expect } from 'vitest';
import { aggregateDistributions, type DistributionRow } from '@/grades/aggregate';

const row = (
  average: number | null,
  count: number | null,
  distribution: Record<string, number | null> = {},
): DistributionRow => ({ average, count, distribution });

describe('aggregateDistributions', () => {
  it('returns an empty summary for no rows', () => {
    const s = aggregateDistributions([]);
    expect(s.sectionCount).toBe(0);
    expect(s.studentCount).toBe(0);
    // Never 0.0 — that would read as everyone failing (spec 7).
    expect(s.average).toBeNull();
  });

  it('weights the average by student count, not by section', () => {
    // 300 students at 80 and 10 students at 50 -> much closer to 80 than 65.
    const s = aggregateDistributions([row(80, 300), row(50, 10)]);
    expect(s.average).toBeCloseTo((80 * 300 + 50 * 10) / 310, 4);
    expect(s.sectionCount).toBe(2);
    expect(s.studentCount).toBe(310);
  });

  it('ignores rows with a suppressed average', () => {
    const s = aggregateDistributions([row(80, 100), row(null, 20)]);
    expect(s.average).toBeCloseTo(80);
  });

  it('ignores rows with no student count rather than assuming one', () => {
    const s = aggregateDistributions([row(80, 100), row(60, null)]);
    expect(s.average).toBeCloseTo(80);
  });

  it('sums buckets across sections, skipping suppressed values', () => {
    const s = aggregateDistributions([
      row(80, 10, { '<50': 1, '90-100': 5 }),
      row(80, 10, { '<50': null, '90-100': 3 }),
    ]);
    expect(s.distribution['<50']).toBe(1);
    expect(s.distribution['90-100']).toBe(8);
  });

  it('reports a bucket as null only when every section suppressed it', () => {
    const s = aggregateDistributions([
      row(80, 10, { '50-54': null }),
      row(80, 10, { '50-54': null }),
    ]);
    expect(s.distribution['50-54']).toBeNull();
  });

  it('flags when any section had suppressed buckets', () => {
    expect(aggregateDistributions([row(80, 10, { '<50': 1 })]).suppressed).toBe(false);
    expect(aggregateDistributions([row(80, 10, { '<50': null })]).suppressed).toBe(true);
  });
});
