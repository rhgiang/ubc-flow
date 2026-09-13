import { describe, it, expect } from 'vitest';
import { courseColorIndex, COURSE_COLOR_COUNT } from '@/schedule/colors';

describe('courseColorIndex', () => {
  it('always returns a 1-based index inside the palette', () => {
    for (const code of ['CPSC 110', 'MATH 200', 'BIOL 121', 'x', '', 'ZZZZ 999']) {
      const i = courseColorIndex(code);
      expect(i).toBeGreaterThanOrEqual(1);
      expect(i).toBeLessThanOrEqual(COURSE_COLOR_COUNT);
      expect(Number.isInteger(i)).toBe(true);
    }
  });

  it('is deterministic - the same code always gets the same slot', () => {
    expect(courseColorIndex('CPSC 110')).toBe(courseColorIndex('CPSC 110'));
    expect(courseColorIndex('MATH 200')).toBe(courseColorIndex('MATH 200'));
  });

  it('spreads a realistic course load across several slots', () => {
    const load = ['CPSC 110', 'MATH 200', 'BIOL 121', 'DSCI 100', 'STAT 201'];
    const slots = new Set(load.map(courseColorIndex));
    // Not a uniqueness guarantee (collisions are legal in 8 slots) - just proof
    // it is not degenerate and mapping everything to one colour.
    expect(slots.size).toBeGreaterThan(1);
  });

  it('does not collide for two courses in the same subject', () => {
    expect(courseColorIndex('CPSC 110')).not.toBe(courseColorIndex('CPSC 121'));
  });
});
