import { describe, it, expect } from 'vitest';
import { validateCourseRating, validateInstructorRating } from '@/reviews/validate';

const validCourse = {
  liked: true,
  useful: 3,
  difficulty: 2,
  workloadHours: 8,
  text: 'Solid course.',
};

describe('validateCourseRating', () => {
  it('accepts a well-formed rating', () => {
    const r = validateCourseRating(validCourse);
    expect(r.ok).toBe(true);
  });

  it('accepts the full 0-4 score range at both ends', () => {
    expect(validateCourseRating({ ...validCourse, useful: 0, difficulty: 0 }).ok).toBe(true);
    expect(validateCourseRating({ ...validCourse, useful: 4, difficulty: 4 }).ok).toBe(true);
  });

  it('rejects a score above the stored range', () => {
    // 5 is the DISPLAY value; storage is 0-4. A 5 reaching this layer means
    // the 1-5 -> 0-4 conversion was skipped somewhere.
    expect(validateCourseRating({ ...validCourse, useful: 5 }).ok).toBe(false);
  });

  it('rejects a negative score', () => {
    expect(validateCourseRating({ ...validCourse, difficulty: -1 }).ok).toBe(false);
  });

  it('rejects a non-integer score', () => {
    expect(validateCourseRating({ ...validCourse, useful: 2.5 }).ok).toBe(false);
  });

  it('allows omitted optional scores', () => {
    const r = validateCourseRating({ liked: null, useful: null, difficulty: null, workloadHours: null, text: null });
    expect(r.ok).toBe(true);
  });

  it('rejects absurd workload hours', () => {
    expect(validateCourseRating({ ...validCourse, workloadHours: -5 }).ok).toBe(false);
    expect(validateCourseRating({ ...validCourse, workloadHours: 200 }).ok).toBe(false);
  });

  it('rejects text beyond the length cap', () => {
    expect(validateCourseRating({ ...validCourse, text: 'x'.repeat(5001) }).ok).toBe(false);
  });

  it('trims text and treats whitespace-only as absent', () => {
    const r = validateCourseRating({ ...validCourse, text: '   ' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.text).toBeNull();
  });
});

describe('validateInstructorRating', () => {
  it('accepts a well-formed instructor rating', () => {
    expect(validateInstructorRating({ liked: true, clear: 4, engaging: 3, text: 'Great.' }).ok).toBe(true);
  });

  it('rejects an out-of-range clarity score', () => {
    expect(validateInstructorRating({ liked: true, clear: 9, engaging: 3, text: null }).ok).toBe(false);
  });

  it('allows an all-empty instructor rating', () => {
    expect(validateInstructorRating({ liked: null, clear: null, engaging: null, text: null }).ok).toBe(true);
  });
});
