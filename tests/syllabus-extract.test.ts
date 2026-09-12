import { describe, it, expect } from 'vitest';
import { normalizeAssessments, ASSESSMENT_TOOL } from '@/syllabus/schema';

const recorded = {
  assessments: [
    { title: 'Midterm 1', kind: 'midterm', date: '2026-10-14', startTime: '18:00',
      weight: 20, quote: 'Midterm 1: Tuesday October 14, 6:00pm (20%)', page: 3 },
    { title: 'Final Exam', kind: 'final', date: null, startTime: null,
      weight: 45, quote: 'Final exam (45%), scheduled by the registrar', page: 3 },
  ],
};

describe('ASSESSMENT_TOOL', () => {
  // strict:true requires both, or the API rejects the tool definition.
  it('is strict and closed', () => {
    expect(ASSESSMENT_TOOL.strict).toBe(true);
    const schema = ASSESSMENT_TOOL.input_schema as Record<string, unknown>;
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toContain('assessments');
  });
});

describe('normalizeAssessments', () => {
  it('parses recorded tool input', () => {
    const out = normalizeAssessments(recorded);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ title: 'Midterm 1', kind: 'midterm', weight: 20, page: 3 });
  });

  it('keeps an undated final rather than dropping it', () => {
    expect(normalizeAssessments(recorded)[1].date).toBeNull();
  });

  it('drops a row with an unknown kind instead of guessing', () => {
    const out = normalizeAssessments({
      assessments: [{ ...recorded.assessments[0], kind: 'participation' }],
    });
    expect(out).toEqual([]);
  });

  // Every saved row is shown to a student beside its quote; a row without one
  // cannot be checked, so it is not offered.
  it('drops a row with no quote', () => {
    const out = normalizeAssessments({
      assessments: [{ ...recorded.assessments[0], quote: '' }],
    });
    expect(out).toEqual([]);
  });

  it('returns empty for malformed input rather than throwing', () => {
    expect(normalizeAssessments(null)).toEqual([]);
    expect(normalizeAssessments({ assessments: 'nope' })).toEqual([]);
  });
});
