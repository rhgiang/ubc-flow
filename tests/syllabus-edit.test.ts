import { describe, it, expect } from 'vitest';
import { normalizeSavedAssessment, toSavedAssessmentRow } from '@/syllabus/schema';

const extracted = {
  title: 'Midterm 1', kind: 'midterm', date: '2026-10-14', startTime: '18:00',
  weight: 20, quote: 'Midterm 1: Tuesday October 14, 6:00pm (20%)', page: 3,
};
const manual = {
  title: 'Midterm 2', kind: 'midterm', date: '2026-11-18', startTime: null,
  weight: null, quote: null, page: null, manual: true,
};

describe('normalizeSavedAssessment', () => {
  it('saves a hand-typed row with no quote, because the student is the evidence', () => {
    expect(normalizeSavedAssessment(manual)).toEqual({
      title: 'Midterm 2', kind: 'midterm', date: '2026-11-18', startTime: null,
      // A typed row is the student's own, so there is no other section's copy
      // of it to tell apart.
      weight: null, section: null, quote: null, page: null, editedByUser: true,
    });
  });

  it('still drops an extracted row with no quote', () => {
    expect(normalizeSavedAssessment({ ...extracted, quote: '' })).toBeNull();
    expect(normalizeSavedAssessment({ ...extracted, quote: undefined })).toBeNull();
    // Claiming a row is manual is the only way to skip the quote, so a row
    // that merely says it was edited does not get the exemption.
    expect(normalizeSavedAssessment({ ...extracted, quote: '', edited: true })).toBeNull();
  });

  it('keeps an extracted row and its evidence', () => {
    expect(normalizeSavedAssessment(extracted)).toMatchObject({
      quote: extracted.quote, page: 3, editedByUser: false,
    });
  });

  it('validates kind whatever the origin', () => {
    expect(normalizeSavedAssessment({ ...manual, kind: 'participation' })).toBeNull();
    expect(normalizeSavedAssessment({ ...extracted, kind: 'participation' })).toBeNull();
  });

  it('needs a title whatever the origin', () => {
    expect(normalizeSavedAssessment({ ...manual, title: '  ' })).toBeNull();
    expect(normalizeSavedAssessment({ ...extracted, title: '' })).toBeNull();
  });

  it('sets editedByUser on a row the student changed, not on one they left alone', () => {
    expect(normalizeSavedAssessment({ ...extracted, edited: true })?.editedByUser).toBe(true);
    expect(normalizeSavedAssessment({ ...extracted, edited: false })?.editedByUser).toBe(false);
    // A hand-typed row is the student's work however the client flagged it.
    expect(normalizeSavedAssessment({ ...manual, edited: false })?.editedByUser).toBe(true);
  });
});

describe('toSavedAssessmentRow', () => {
  const stored = {
    title: 'Midterm 1', kind: 'midterm', date: new Date('2026-10-14T00:00:00Z'),
    startTime: '18:00', weight: 20, quote: 'Midterm 1: Tuesday October 14',
    page: 3, editedByUser: false,
  };

  it('gives the editor a YYYY-MM-DD date', () => {
    expect(toSavedAssessmentRow(stored)?.date).toBe('2026-10-14');
    expect(toSavedAssessmentRow({ ...stored, date: null })?.date).toBeNull();
  });

  it('round-trips a hand-typed row back through the save validator', () => {
    const row = toSavedAssessmentRow({ ...stored, quote: null, page: null, editedByUser: true })!;
    expect(row.quote).toBeNull();
    // What the editor would POST for an untouched manual row.
    expect(normalizeSavedAssessment({ ...row, manual: true })?.editedByUser).toBe(true);
  });

  it('drops the half-evidence case rather than citing a page nobody can find', () => {
    expect(toSavedAssessmentRow({ ...stored, page: null })).toMatchObject({ quote: null, page: null });
  });

  it('skips a row whose kind the editor cannot represent', () => {
    expect(toSavedAssessmentRow({ ...stored, kind: 'participation' })).toBeNull();
  });
});
