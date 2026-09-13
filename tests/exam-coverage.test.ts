import { describe, it, expect } from 'vitest';
import { examCoverage, type ExamListItem } from '@/schedule/exams';

function exam(over: Partial<ExamListItem> & { id: string }): ExamListItem {
  return {
    courseLabel: 'MATH 200',
    sectionCode: '101',
    date: new Date('2026-12-15T00:00:00Z'),
    startTime: '12:00',
    location: 'MATH 100',
    alphaSplit: null,
    notes: null,
    cancelled: false,
    source: 'ubc',
    kind: 'final',
    ...over,
  };
}

// The whole point: "this course has no final" and "UBC hasn't said yet" mean
// opposite things, and the page used to render both as the same blank space.
describe('examCoverage', () => {
  const enrolled = ['MATH 200', 'CPSC 110', 'CRWR 200', 'SCIE 113'];

  it('says nothing about anyone’s courses before the term has any exam row', () => {
    const coverage = examCoverage([], enrolled, false);
    expect(coverage).toEqual({ published: false });
  });

  it('stays unpublished even with rows in hand, if the term has none', () => {
    // Defensive: a syllabus-derived midterm is not UBC publishing anything.
    const coverage = examCoverage([exam({ id: 'm', kind: 'midterm', source: 'syllabus' })], enrolled, false);
    expect(coverage.published).toBe(false);
  });

  it('names the enrolled courses missing from a published schedule', () => {
    const coverage = examCoverage(
      [exam({ id: 'a' }), exam({ id: 'b', courseLabel: 'CPSC 110' })],
      enrolled,
      true,
    );
    expect(coverage).toEqual({ published: true, noFinal: ['CRWR 200', 'SCIE 113'] });
  });

  it('counts a course covered even when its exam rows are all for other students’ courses', () => {
    // One row anywhere in the term publishes the schedule — the student may
    // legitimately have no exams at all, and every course is then reportable.
    const coverage = examCoverage([], ['CRWR 200'], true);
    expect(coverage).toEqual({ published: true, noFinal: ['CRWR 200'] });
  });

  it('treats a split exam’s several rooms as one covered course', () => {
    const coverage = examCoverage(
      [
        exam({ id: 'a', courseLabel: 'BIOL 121', alphaSplit: 'ABB-MEN', location: 'IRC 2' }),
        exam({ id: 'b', courseLabel: 'BIOL 121', alphaSplit: 'MER-ZHU', location: 'IRC 6' }),
      ],
      ['BIOL 121'],
      true,
    );
    expect(coverage).toEqual({ published: true, noFinal: [] });
  });

  it('counts a cancelled final as covered — the struck-through card says it better', () => {
    const coverage = examCoverage(
      [exam({ id: 'a', courseLabel: 'ENGL 230', cancelled: true, date: null })],
      ['ENGL 230'],
      true,
    );
    expect(coverage).toEqual({ published: true, noFinal: [] });
  });

  it('counts a syllabus final as covered, so the note can’t contradict the card above it', () => {
    const coverage = examCoverage(
      [exam({ id: 'a', courseLabel: 'CRWR 200', source: 'syllabus' })],
      ['CRWR 200'],
      true,
    );
    expect(coverage).toEqual({ published: true, noFinal: [] });
  });

  it('does not let a midterm stand in for a final', () => {
    const coverage = examCoverage(
      [exam({ id: 'a', courseLabel: 'SCIE 113', kind: 'midterm', source: 'syllabus' })],
      ['SCIE 113'],
      true,
    );
    expect(coverage).toEqual({ published: true, noFinal: ['SCIE 113'] });
  });

  it('reports a duplicated enrollment once', () => {
    const coverage = examCoverage([], ['CRWR 200', 'CRWR 200'], true);
    expect(coverage).toEqual({ published: true, noFinal: ['CRWR 200'] });
  });
});
