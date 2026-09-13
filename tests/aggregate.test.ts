import { describe, it, expect } from 'vitest';
import {
  aggregateCourseReviews,
  aggregateInstructorReviews,
  toDisplayScore,
  toStoredScore,
} from '@/reviews/aggregate';

describe('score conversion', () => {
  it('converts storage 0-4 to display 1-5', () => {
    expect(toDisplayScore(0)).toBe(1);
    expect(toDisplayScore(4)).toBe(5);
  });

  it('converts display 1-5 to storage 0-4', () => {
    expect(toStoredScore(1)).toBe(0);
    expect(toStoredScore(5)).toBe(4);
  });

  it('round-trips', () => {
    for (const d of [1, 2, 3, 4, 5]) expect(toDisplayScore(toStoredScore(d))).toBe(d);
  });

  it('passes null through both ways', () => {
    expect(toDisplayScore(null)).toBeNull();
    expect(toStoredScore(null)).toBeNull();
  });
});

describe('aggregateCourseReviews', () => {
  it('returns an empty aggregate for no reviews', () => {
    const a = aggregateCourseReviews([]);
    expect(a.count).toBe(0);
    // Never 0 - a zero would render as a terrible score rather than "no data".
    expect(a.useful).toBeNull();
    expect(a.difficulty).toBeNull();
    expect(a.likedPercent).toBeNull();
  });

  it('averages scores and reports them on the 1-5 display scale', () => {
    const a = aggregateCourseReviews([
      { liked: true, useful: 4, difficulty: 2, workloadHours: 10 },
      { liked: true, useful: 2, difficulty: 0, workloadHours: 6 },
    ]);
    expect(a.count).toBe(2);
    // stored mean 3 -> display 4
    expect(a.useful).toBeCloseTo(4);
    // stored mean 1 -> display 2
    expect(a.difficulty).toBeCloseTo(2);
  });

  it('computes liked as a percentage', () => {
    const a = aggregateCourseReviews([
      { liked: true, useful: null, difficulty: null, workloadHours: null },
      { liked: false, useful: null, difficulty: null, workloadHours: null },
      { liked: true, useful: null, difficulty: null, workloadHours: null },
    ]);
    expect(a.likedPercent).toBe(67);
  });

  it('ignores nulls rather than counting them as zero', () => {
    const a = aggregateCourseReviews([
      { liked: null, useful: 4, difficulty: null, workloadHours: null },
      { liked: null, useful: null, difficulty: null, workloadHours: null },
    ]);
    expect(a.useful).toBeCloseTo(5);
    expect(a.difficulty).toBeNull();
    expect(a.likedPercent).toBeNull();
  });

  it('averages workload in raw hours, not on the 1-5 scale', () => {
    const a = aggregateCourseReviews([
      { liked: null, useful: null, difficulty: null, workloadHours: 10 },
      { liked: null, useful: null, difficulty: null, workloadHours: 20 },
    ]);
    expect(a.workloadHours).toBeCloseTo(15);
  });
});

describe('aggregateInstructorReviews', () => {
  it('returns an empty aggregate for no reviews', () => {
    const a = aggregateInstructorReviews([]);
    expect(a.count).toBe(0);
    expect(a.clear).toBeNull();
    expect(a.engaging).toBeNull();
    expect(a.likedPercent).toBeNull();
  });

  it('averages clarity and engagement on the display scale', () => {
    const a = aggregateInstructorReviews([
      { liked: true, clear: 4, engaging: 4 },
      { liked: false, clear: 2, engaging: 0 },
    ]);
    expect(a.count).toBe(2);
    expect(a.clear).toBeCloseTo(4);
    expect(a.engaging).toBeCloseTo(3);
    expect(a.likedPercent).toBe(50);
  });
});

describe('aggregateCourseReviews histograms', () => {
  it('counts each display-scale rating (1-5) for useful and difficulty', () => {
    // Stored 0-4 -> displayed 1-5.
    const rows = [
      { liked: true, useful: 4, difficulty: 0, workloadHours: null },
      { liked: true, useful: 4, difficulty: 0, workloadHours: null },
      { liked: false, useful: 0, difficulty: 3, workloadHours: null },
    ];
    const { histograms } = aggregateCourseReviews(rows);
    expect(histograms.useful).toEqual({ 1: 1, 2: 0, 3: 0, 4: 0, 5: 2 });
    expect(histograms.difficulty).toEqual({ 1: 2, 2: 0, 3: 0, 4: 1, 5: 0 });
  });

  it('excludes null ratings from the histogram, not as a 0 bucket', () => {
    const { histograms } = aggregateCourseReviews([
      { liked: null, useful: null, difficulty: null, workloadHours: null },
    ]);
    expect(histograms.useful).toEqual({ 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 });
  });

  it('returns all-zero histograms for no reviews, never undefined', () => {
    const { histograms } = aggregateCourseReviews([]);
    expect(histograms.useful).toEqual({ 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 });
    expect(histograms.difficulty).toEqual({ 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 });
  });
});

describe('aggregateInstructorReviews histograms', () => {
  it('counts clear and engaging ratings', () => {
    const { histograms } = aggregateInstructorReviews([
      { liked: true, clear: 4, engaging: 4 },
      { liked: true, clear: 2, engaging: 4 },
    ]);
    expect(histograms.clear).toEqual({ 1: 0, 2: 0, 3: 1, 4: 0, 5: 1 });
    expect(histograms.engaging).toEqual({ 1: 0, 2: 0, 3: 0, 4: 0, 5: 2 });
  });
});
