import { describe, it, expect } from 'vitest';
import { findBuilding, floorFromRoom } from '@/map/buildings';

describe('floorFromRoom', () => {
  it('reads the floor off the leading digit', () => {
    expect(floorFromRoom('121')).toBe('Floor 1');
    expect(floorFromRoom('2207')).toBe('Floor 2');
    expect(floorFromRoom('4068')).toBe('Floor 4');
  });

  it('reads B-prefixed rooms as basement', () => {
    expect(floorFromRoom('B101')).toBe('Basement');
  });

  it('refuses to guess when nothing encodes a floor', () => {
    expect(floorFromRoom('12')).toBeNull();
    expect(floorFromRoom(null)).toBeNull();
    expect(floorFromRoom('')).toBeNull();
    expect(floorFromRoom('X200')).toBeNull();
  });
});

describe('findBuilding', () => {
  it('locates the codes Workday actually writes', () => {
    for (const code of ['SWNG', 'ICCS', 'ESB', 'MATH', 'HENN']) {
      const b = findBuilding(code);
      expect(b, code).not.toBeNull();
      expect(b!.lat).toBeGreaterThan(49);
      expect(b!.lng).toBeLessThan(-123);
    }
  });

  it('returns null for unknown or missing codes', () => {
    expect(findBuilding('NOPE')).toBeNull();
    expect(findBuilding(null)).toBeNull();
  });
});
