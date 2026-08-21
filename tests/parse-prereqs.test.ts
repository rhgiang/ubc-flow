import { describe, it, expect } from 'vitest';
import { parseRequirements, type Requirement } from '@/prereqs/parse';

/** Collect every course code in a tree, for terse assertions. */
function codes(node: Requirement | null): string[] {
  if (!node) return [];
  if (node.type === 'course') return [node.code];
  if (node.type === 'note') return [];
  return node.items.flatMap(codes);
}

describe('parseRequirements', () => {
  it('returns null for empty input', () => {
    expect(parseRequirements(null)).toBeNull();
    expect(parseRequirements('')).toBeNull();
    expect(parseRequirements('   ')).toBeNull();
  });

  it('parses "One of" as an OR', () => {
    // Real row: the first half of FRST 305's requirement.
    const r = parseRequirements('One of FRST 201, NRES 201.')!;
    expect(r.type).toBe('or');
    expect(codes(r)).toEqual(['FRST 201', 'NRES 201']);
  });

  it('parses "All of" as an AND', () => {
    // Real row: POLI 482.
    const r = parseRequirements('All of POLI_V 310, POLI_V 380, POLI_V 381.')!;
    expect(r.type).toBe('and');
    expect(codes(r)).toEqual(['POLI 310', 'POLI 380', 'POLI 381']);
  });

  it('strips the _V campus suffix from displayed codes', () => {
    const r = parseRequirements('FNH 200.')!;
    expect(r).toEqual({ type: 'course', code: 'FNH 200', courseId: null });
  });

  it('keeps the _O campus suffix, since it is a different campus', () => {
    // Must stay distinguishable: resolving MGMT_O 301 against Vancouver would
    // attach the wrong course entirely.
    const r = parseRequirements('One of COMM_V 293, MGMT_O 301.')!;
    expect(codes(r)).toEqual(['COMM 293', 'MGMT_O 301']);
  });

  it('parses a single bare course code', () => {
    // Real row: FNH 325.
    const r = parseRequirements('FNH 200.')!;
    expect(r.type).toBe('course');
  });

  it('treats a bare comma list with a trailing "and" as an AND', () => {
    // Real row: COMM 459. UBC convention: an unqualified list means all required.
    const r = parseRequirements('COMM_V 293, COMM_V 298 and COMM_V 370.')!;
    expect(r.type).toBe('and');
    expect(codes(r)).toEqual(['COMM 293', 'COMM 298', 'COMM 370']);
  });

  it('parses an AND of two OR groups', () => {
    // Real row: FRST 305.
    const r = parseRequirements(
      'One of FRST 201, NRES 201 and one of FRST 350, FRST 351, UFOR 400.',
    )!;
    expect(r.type).toBe('and');
    expect(r.type === 'and' && r.items.map((i) => i.type)).toEqual(['or', 'or']);
    expect(codes(r)).toEqual([
      'FRST 201', 'NRES 201', 'FRST 350', 'FRST 351', 'UFOR 400',
    ]);
  });

  it('parses a course AND-ed with OR groups', () => {
    // Real row: CPSC 314.
    const r = parseRequirements(
      'CPSC_V 221 and one of MATH_V 200, MATH_V 217, MATH_V 226, MATH_V 253, MATH_O 200 and one of MATH_V 152, MATH_V 221, MATH_V 223, MATH_O 222.',
    )!;
    expect(r.type).toBe('and');
    expect(r.type === 'and' && r.items.map((i) => i.type)).toEqual([
      'course', 'or', 'or',
    ]);
    expect(codes(r)[0]).toBe('CPSC 221');
  });

  it('strips Equivalency clauses instead of treating them as requirements', () => {
    // Real row: CHEM 121. CHEM 141 is a credit exclusion, NOT a prerequisite.
    const r = parseRequirements('One of CHEM_V 12, CHEM_V 100. Equivalency: CHEM_V 141')!;
    expect(codes(r)).toEqual(['CHEM 12', 'CHEM 100']);
    expect(codes(r)).not.toContain('CHEM 141');
  });

  it('strips Equivalency clauses that list several codes', () => {
    // Real row: COMM 294.
    const r = parseRequirements(
      'One of COEC_V 293, COMM_V 293, MGMT_O 301. Equivalency: COEC_V 294, MGMT_O 202.',
    )!;
    expect(codes(r)).toEqual(['COEC 293', 'COMM 293', 'MGMT_O 301']);
    expect(codes(r)).not.toContain('COEC 294');
  });

  it('bails out to a note on permission language', () => {
    // Real row: MINE 590Q.
    const r = parseRequirements('Permission of instructor is required.')!;
    expect(r).toEqual({ type: 'note', text: 'Permission of instructor is required' });
  });

  it('bails out to a note on a grade-qualified list, never a plain OR', () => {
    // Real row: VISA 250. The real requirement is TWO of three WITH a grade
    // floor; emitting an OR would say "any one of three" — materially wrong.
    const r = parseRequirements(
      'A score of 72% or higher in two of VISA 110, VISA 180, VISA 183.',
    )!;
    expect(r.type).toBe('note');
  });

  it('bails out to a note on lettered alternatives, even after "All of"', () => {
    // Real row: KIN 211. Starts with "All of" but is really one-of-each-group.
    // Flattening this to an AND would tell a student to take all five courses.
    const r = parseRequirements(
      'All of (a) KIN_V 110 or HES_O 120 and (b) KIN_V 131 or HES_O 101 or BIOL_O 131.',
    )!;
    expect(r.type).toBe('note');
  });

  it('bails out to a note on a standalone "or" it cannot group', () => {
    const r = parseRequirements('CPSC_V 110 or CPSC_V 103.')!;
    expect(r.type).toBe('note');
  });

  it('keeps a parseable clause and notes an unparseable one from the same text', () => {
    // Real row: MDIA 490 — a real requirement plus a program restriction.
    const r = parseRequirements(
      'MDIA_V 350. Restricted to BMS students with 4th year standing.',
    )!;
    expect(r.type).toBe('and');
    expect(r.type === 'and' && r.items.map((i) => i.type)).toEqual(['course', 'note']);
    expect(codes(r)).toEqual(['MDIA 350']);
  });

  it('notes prose that mentions no course code at all', () => {
    const r = parseRequirements('Fourth-year standing.')!;
    expect(r.type).toBe('note');
  });

  it('parses corequisite text with the same machinery', () => {
    // Real coreq row: SCIE 300 — an OR group plus a standing clause.
    const r = parseRequirements(
      'One of BIOL_V 300, STAT_V 200, STAT_V 241 and 3rd or 4th year standing in Combined Major in Science.',
    )!;
    // The whole clause carries "standing", so it bails wholesale rather than
    // half-parsing a requirement whose real gate we cannot express.
    expect(r.type).toBe('note');
  });

  it('never emits an empty group', () => {
    const r = parseRequirements('One of FRST 201, NRES 201 and one of FRST 350, FRST 351.')!;
    const walk = (n: Requirement): void => {
      if (n.type === 'and' || n.type === 'or') {
        expect(n.items.length).toBeGreaterThan(1);
        n.items.forEach(walk);
      }
    };
    walk(r);
  });
});
