import { describe, it, expect } from 'vitest';
import { buildSearchWhere } from '@/lib/search';

describe('buildSearchWhere', () => {
  it('matches a subject code and number typed together', () => {
    const where = buildSearchWhere('cpsc 221');
    expect(where.AND).toBeDefined();
    expect(JSON.stringify(where)).toContain('CPSC');
    expect(JSON.stringify(where)).toContain('221');
  });

  it('matches a bare subject code', () => {
    expect(JSON.stringify(buildSearchWhere('cpsc'))).toContain('CPSC');
  });

  it('falls back to a title search for prose', () => {
    expect(JSON.stringify(buildSearchWhere('data structures'))).toContain('data structures');
  });

  it('handles empty input without throwing', () => {
    expect(() => buildSearchWhere('')).not.toThrow();
  });
});
