import { describe, it, expect } from 'vitest';
import { normalizeInstructorName } from '@/scrape/names';

describe('normalizeInstructorName', () => {
  it('flips "Last, First" to "First Last"', () => {
    expect(normalizeInstructorName('Smith, John')).toEqual({
      name: 'John Smith',
      slug: 'john-smith',
    });
  });

  it('leaves "First Last" alone', () => {
    expect(normalizeInstructorName('Parsa Rajabi')).toEqual({
      name: 'Parsa Rajabi',
      slug: 'parsa-rajabi',
    });
  });

  it('title-cases shouting input', () => {
    expect(normalizeInstructorName('SMITH, JOHN').name).toBe('John Smith');
  });

  it('collapses whitespace', () => {
    expect(normalizeInstructorName('  Smith,   John  ').name).toBe('John Smith');
  });

  it('handles hyphenated names', () => {
    expect(normalizeInstructorName('Garcia-Lopez, Ana').name).toBe('Ana Garcia-Lopez');
  });

  it('strips accents for the slug but keeps them in the name', () => {
    const r = normalizeInstructorName('Müller, Jörg');
    expect(r.name).toBe('Jörg Müller');
    expect(r.slug).toBe('jorg-muller');
  });

  it('strips accents for the slug but keeps them in the name (second case)', () => {
    const r = normalizeInstructorName('François Côté');
    expect(r.name).toBe('François Côté');
    expect(r.slug).toBe('francois-cote');
  });

  it('handles a single-token name', () => {
    expect(normalizeInstructorName('Plato')).toEqual({ name: 'Plato', slug: 'plato' });
  });

  it('returns an empty slug for blank input, which callers must filter', () => {
    expect(normalizeInstructorName('')).toEqual({ name: '', slug: '' });
    expect(normalizeInstructorName('   ')).toEqual({ name: '', slug: '' });
  });
});
