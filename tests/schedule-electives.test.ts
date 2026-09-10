import { describe, it, expect } from 'vitest';
import { suggestElectives } from '@/schedule/electives';
import type { CourseRef, CourseSet } from '@/guidance/rules';

const TERM = 'term-w1';

function course(code: string, faculty: string | null = 'Arts'): CourseRef {
  const [subject, number] = code.split(' ');
  return { id: `id-${code}`, subject, number, code, credits: 3, faculty };
}

function ctx(catalogue: CourseRef[], opts: Partial<Parameters<typeof suggestElectives>[0]> = {}) {
  return {
    set: { kind: 'pattern' } as CourseSet,
    catalogue,
    offerings: new Map(catalogue.map((c) => [c.id, new Set([TERM])])),
    termId: TERM,
    prereqs: new Map(),
    satisfied: new Set<string>(),
    year: 2,
    exclude: new Set<string>(),
    ...opts,
  };
}

describe('suggestElectives', () => {
  it('never suggests a graduate course', () => {
    const cat = [course('ENGL 510A'), course('ENGL 101')];
    const out = suggestElectives(ctx(cat));
    expect(out.map((c) => c.code)).toEqual(['ENGL 101']);
  });

  it('keeps suggestions within one year of the student', () => {
    const cat = [course('PSYC 101'), course('PSYC 301'), course('PSYC 401')];
    // A second-year may stretch to 300, not to 400.
    expect(suggestElectives(ctx(cat, { year: 2 })).map((c) => c.code)).toEqual([
      'PSYC 301',
      'PSYC 101',
    ]);
  });

  it('drops anything not offered in the term being built', () => {
    const cat = [course('PSYC 101'), course('PSYC 102')];
    const offerings = new Map([
      ['id-PSYC 101', new Set([TERM])],
      ['id-PSYC 102', new Set(['some-other-term'])],
    ]);
    expect(suggestElectives(ctx(cat, { offerings })).map((c) => c.code)).toEqual(['PSYC 101']);
  });

  it('drops a course whose prerequisites the student will not hold', () => {
    const cat = [course('PSYC 101'), course('PSYC 260')];
    const prereqs = new Map<string, any>([
      ['id-PSYC 260', { type: 'course', courseId: 'id-PSYC 101' }],
    ]);
    expect(suggestElectives(ctx(cat, { prereqs })).map((c) => c.code)).toEqual(['PSYC 101']);
    // ...and keeps it once that prerequisite is in hand.
    const withIt = suggestElectives(
      ctx(cat, { prereqs, satisfied: new Set(['id-PSYC 101']) }),
    );
    expect(withIt.map((c) => c.code)).toContain('PSYC 260');
  });

  it('respects the requirement set and the exclusion list', () => {
    const cat = [course('PSYC 101'), course('CPSC 110', 'Science')];
    const set = { kind: 'pattern', faculty: 'Arts' } as CourseSet;
    expect(suggestElectives(ctx(cat, { set })).map((c) => c.code)).toEqual(['PSYC 101']);
    expect(
      suggestElectives(ctx(cat, { set, exclude: new Set(['id-PSYC 101']) })),
    ).toEqual([]);
  });

  it('leads with the most senior option a student can take', () => {
    const cat = [course('CPSC 110'), course('CPSC 310'), course('CPSC 210')];
    const out = suggestElectives(ctx(cat, { year: 3 }));
    expect(out[0].code).toBe('CPSC 310');
  });
});
