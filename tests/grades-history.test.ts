import { describe, it, expect } from 'vitest';
import { buildCourseGradeHistory, resolveTermKey } from '@/grades/history';

const NO_TERMS = new Map<string, { year: number; session: string }>();

describe('resolveTermKey', () => {
  it('reads year and session out of the ingest sentinel', () => {
    expect(resolveTermKey('unmatched-2016W', NO_TERMS)).toEqual({ year: 2016, session: 'W' });
    expect(resolveTermKey('unmatched-2023S', NO_TERMS)).toEqual({ year: 2023, session: 'S' });
  });

  it('falls back to the real Term catalogue for a cuid termId', () => {
    const terms = new Map([['cmszrm7g900014ggnyenc4w7s', { year: 2025, session: 'W' }]]);
    expect(resolveTermKey('cmszrm7g900014ggnyenc4w7s', terms)).toEqual({ year: 2025, session: 'W' });
  });

  it('returns null for a termId it cannot place', () => {
    expect(resolveTermKey('some-unknown-id', NO_TERMS)).toBeNull();
  });
});

describe('buildCourseGradeHistory', () => {
  it('weights each term by students, not by section count', () => {
    // A 300-person lecture at 80 and a 10-person seminar at 50 must land far
    // nearer 80 than the unweighted mean of 65.
    const { terms } = buildCourseGradeHistory(
      [
        { termId: 'unmatched-2016W', average: 80, count: 300 },
        { termId: 'unmatched-2016W', average: 50, count: 10 },
      ],
      NO_TERMS,
    );
    expect(terms).toHaveLength(1);
    expect(terms[0].average).toBeCloseTo((80 * 300 + 50 * 10) / 310, 4);
    expect(terms[0].students).toBe(310);
  });

  it('orders Summer before Winter within an academic year', () => {
    const { terms } = buildCourseGradeHistory(
      [
        { termId: 'unmatched-2017W', average: 70, count: 10 },
        { termId: 'unmatched-2016S', average: 71, count: 10 },
        { termId: 'unmatched-2016W', average: 72, count: 10 },
      ],
      NO_TERMS,
    );
    expect(terms.map((t) => `${t.year}${t.session}`)).toEqual(['2016S', '2016W', '2017W']);
  });

  it('reports the lowest and highest single-section averages', () => {
    const { lowestSection, highestSection } = buildCourseGradeHistory(
      [
        { termId: 'unmatched-2016W', average: 64.1, count: 100 },
        { termId: 'unmatched-2016W', average: 91, count: 20 },
        { termId: 'unmatched-2017W', average: 75, count: 50 },
      ],
      NO_TERMS,
    );
    expect(lowestSection).toBeCloseTo(64.1);
    expect(highestSection).toBeCloseTo(91);
  });

  it('skips sections with no average or no headcount rather than scoring them 0', () => {
    const { terms, lowestSection } = buildCourseGradeHistory(
      [
        { termId: 'unmatched-2016W', average: 80, count: 100 },
        { termId: 'unmatched-2016W', average: null, count: 50 },
        { termId: 'unmatched-2016W', average: 60, count: null },
        { termId: 'unmatched-2016W', average: 60, count: 0 },
      ],
      NO_TERMS,
    );
    expect(terms).toHaveLength(1);
    expect(terms[0].average).toBeCloseTo(80);
    expect(terms[0].students).toBe(100);
    // The unweighable 60s must not register as the low either.
    expect(lowestSection).toBeCloseTo(80);
  });

  it('returns an empty history rather than throwing when nothing is usable', () => {
    const h = buildCourseGradeHistory([{ termId: 'unmatched-2016W', average: null, count: null }], NO_TERMS);
    expect(h.terms).toEqual([]);
    expect(h.lowestSection).toBeNull();
    expect(h.highestSection).toBeNull();
  });
});
