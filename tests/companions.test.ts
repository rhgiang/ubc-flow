import { describe, it, expect } from 'vitest';
import { findMissingCompanions } from '@/schedule/companions';

const s = (code: string, activity: string | null) => ({ code, activity });

describe('findMissingCompanions', () => {
  it('flags a lab-and-tutorial course where only the lecture was added', () => {
    const offered = [
      s('CPSC 110', 'Lecture'),
      s('CPSC 110', 'Laboratory'),
      s('CPSC 110', 'Tutorial'),
    ];
    expect(findMissingCompanions(offered, [s('CPSC 110', 'Lecture')])).toEqual([
      { code: 'CPSC 110', missing: ['Laboratory', 'Tutorial'] },
    ]);
  });

  it('is satisfied once one of each offered activity is chosen', () => {
    const offered = [s('CPSC 110', 'Lecture'), s('CPSC 110', 'Laboratory')];
    const chosen = [s('CPSC 110', 'Lecture'), s('CPSC 110', 'Laboratory')];
    expect(findMissingCompanions(offered, chosen)).toEqual([]);
  });

  it('flags a missing lecture too, not just secondaries', () => {
    const offered = [s('MATH 200', 'Lecture'), s('MATH 200', 'Tutorial')];
    expect(findMissingCompanions(offered, [s('MATH 200', 'Tutorial')])).toEqual([
      { code: 'MATH 200', missing: ['Lecture'] },
    ]);
  });

  it('ignores activity types nobody registers, like waiting lists', () => {
    const offered = [
      s('BIOL 121', 'Lecture'),
      s('BIOL 121', 'Waiting List'),
      s('BIOL 121', 'Work Placement'),
    ];
    expect(findMissingCompanions(offered, [s('BIOL 121', 'Lecture')])).toEqual([]);
  });

  it('a lecture-only course needs nothing else', () => {
    const offered = [s('SCIE 113', 'Lecture')];
    expect(findMissingCompanions(offered, [s('SCIE 113', 'Lecture')])).toEqual([]);
  });

  it('reports several courses in code order', () => {
    const offered = [
      s('PHYS 101', 'Lecture'),
      s('PHYS 101', 'Laboratory'),
      s('CHEM 121', 'Lecture'),
      s('CHEM 121', 'Laboratory'),
    ];
    const chosen = [s('PHYS 101', 'Lecture'), s('CHEM 121', 'Lecture')];
    expect(findMissingCompanions(offered, chosen).map((m) => m.code)).toEqual([
      'CHEM 121',
      'PHYS 101',
    ]);
  });

  it('null activities never create requirements', () => {
    const offered = [s('ASTR 200', null), s('ASTR 200', 'Lecture')];
    expect(findMissingCompanions(offered, [s('ASTR 200', 'Lecture')])).toEqual([]);
  });
});
