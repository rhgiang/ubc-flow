import { describe, it, expect } from 'vitest';
import { parseRequirements, extractAntireqCodes, type Requirement } from '@/prereqs/parse';

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
    // floor; emitting an OR would say "any one of three" - materially wrong.
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
    // Real row: MDIA 490 - a real requirement plus a program restriction.
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
    // Real coreq row: SCIE 300 - an OR group plus a standing clause.
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

  it('treats a trailing bare segment after an OR list as part of the same OR', () => {
    // Real row: SOCI 381, SOCI 382, SOCI 383 (and others like COMM 307).
    // "One of A, B, C and D" where D has no explicit "one of" is still a
    // 4-way OR, not "one of A,B,C PLUS mandatory D".
    const r = parseRequirements('One of SOCI 100, SOCI 101, SOCI 102 and SOCI 217.')!;
    expect(r.type).toBe('or');
    expect(codes(r)).toEqual(['SOCI 100', 'SOCI 101', 'SOCI 102', 'SOCI 217']);
  });

  it('bails to a note on a numeric quantifier ("Three of") instead of a hard AND', () => {
    // Real row: VISA 401F. The real requirement is "any 3 of these 16" - the
    // bare-list AND default must not claim all 16 are mandatory (Finding 1).
    const r = parseRequirements(
      'Three of VISA_V 310, VISA_V 311, VISA_V 320, VISA_V 321, VISA_V 330, VISA_V 331, VISA_V 340, VISA_V 341, VISA_V 350, VISA_V 351, VISA_V 352, VISA_V 360, VISA_V 361, VISA_V 370, VISA_V 375, VISA_V 390.',
    )!;
    expect(r.type).toBe('note');
  });

  it('bails both clauses to notes on "Two of" plus its "Or" continuation', () => {
    // Real row: POLI 310. Real requirement is "any 2 of these 4"; the second
    // clause already correctly bailed before this fix, the first did not
    // (Finding 1) - both must end up as notes, never a 4-way hard AND.
    const r = parseRequirements(
      'Two of POLI 100, POLI 101, POLI 110, POLI 240. Or third-year standing or higher.',
    )!;
    expect(r.type).toBe('and');
    expect(r.type === 'and' && r.items.every((i) => i.type === 'note')).toBe(true);
  });

  it('bails to a note rather than over-collapsing into a flat OR', () => {
    // Real row: ELEC 391. Real requirement is "(one of 3) AND (two of 4)" -
    // before this fix, the OR-collapse heuristic (for "One of A, B and C")
    // wrongly fired on the "two of" segment and flattened all 7 codes into a
    // single OR, which would tell a student one course out of any of the 7
    // satisfies the whole requirement (Finding 2 - over-permissive, worse
    // than Finding 1's over-restrictive AND). Catching "two of" in the
    // ambiguity guard makes the whole clause bail before that logic runs.
    const r = parseRequirements(
      'One of CPEN_V 291, ELEC_V 291, ELEC_V 292 and two of ELEC_V 301, ELEC_V 341, ELEC_V 311, ELEC_V 342.',
    )!;
    expect(r.type).toBe('note');
  });

  it('still parses "one of" normally - the quantifier guard must not catch it', () => {
    const r = parseRequirements('One of FRST 201, NRES 201.')!;
    expect(r.type).toBe('or');
  });

  it('bails a whole clause to a note when one and-segment fails to parse', () => {
    // Real row: BEST 201. A source typo - a stray space inside "BIOL _V 121"
    // - breaks the course-code regex for that segment. Before this fix, the
    // failed segment was silently dropped, leaving a bare `course` node for
    // BIOL 112 with BIOL 121 vanished and no indication anything was missing
    // (Finding 3). The whole clause must bail to a note instead.
    const r = parseRequirements('BIOL_V 112 and BIOL _V 121')!;
    expect(r.type).toBe('note');
  });
});

describe('extractAntireqCodes', () => {
  it('extracts a single equivalency code with no space before the number', () => {
    // Real row: FIPR 437.
    expect(extractAntireqCodes('FIPR 337. Equivalency: FILM437')).toEqual(['FILM 437']);
  });

  it('extracts an equivalency code with a campus suffix', () => {
    // Real row: COMM 396.
    expect(extractAntireqCodes('COMM 196. Equivalency: COMM_V 390')).toEqual(['COMM 390']);
  });

  it('extracts multiple comma-separated equivalency codes', () => {
    // Real row: LLED 402 (from Phase 6 research).
    expect(
      extractAntireqCodes(
        'Fourth-year standing. Equivalency: APSC402, ASTU402, FRST402, LFS 402, PHAR402',
      ),
    ).toEqual(['APSC 402', 'ASTU 402', 'FRST 402', 'LFS 402', 'PHAR 402']);
  });

  it('returns an empty array when there is no Equivalency clause', () => {
    expect(extractAntireqCodes('CPSC_V 221 and one of MATH_V 200, MATH_V 217.')).toEqual([]);
  });

  it('returns an empty array for null input', () => {
    expect(extractAntireqCodes(null)).toEqual([]);
  });
});
