import { describe, it, expect } from 'vitest';
import { parseBody } from '@/scrape/parse-body';

const CPSC221 =
  '<p>Design and analysis of basic algorithms and data structures; algorithm ' +
  'analysis methods, searching and sorting algorithms, basic data structures, ' +
  'graphs and concurrency. [3-2-0] Prerequisite: One of CPSC_V 210, CPEN_V 221 ' +
  'and either (a) one of CPSC_V 121, MATH_V 220, MATH_O 220 or (b) a score of ' +
  '68% or higher in MATH_V 226.</p>';

describe('parseBody', () => {
  it('extracts the description without the prerequisite sentence', () => {
    const r = parseBody(CPSC221);
    expect(r.description).toContain('Design and analysis of basic algorithms');
    expect(r.description).not.toContain('Prerequisite');
  });

  it('captures the whole prerequisite clause including internal periods', () => {
    const r = parseBody(CPSC221);
    expect(r.prereqText).toContain('One of CPSC_V 210');
    expect(r.prereqText).toContain('MATH_V 226');
  });

  it('strips the hours marker from the description', () => {
    expect(parseBody(CPSC221).description).not.toContain('[3-2-0]');
  });

  it('returns nulls for a missing body', () => {
    expect(parseBody(null)).toEqual({
      description: null,
      prereqText: null,
      coreqText: null,
    });
  });

  it('handles a body with no prerequisite', () => {
    const r = parseBody('<p>An introductory survey course.</p>');
    expect(r.description).toBe('An introductory survey course.');
    expect(r.prereqText).toBeNull();
  });

  it('captures a corequisite separately from a prerequisite', () => {
    const r = parseBody(
      '<p>Some description. Prerequisite: MATH_V 100. Corequisite: PHYS_V 101.</p>',
    );
    expect(r.prereqText).toContain('MATH_V 100');
    expect(r.coreqText).toContain('PHYS_V 101');
    expect(r.prereqText).not.toContain('PHYS_V 101');
  });

  it('strips html tags from the description', () => {
    expect(parseBody('<p>Plain <em>text</em> here.</p>').description).toBe(
      'Plain text here.',
    );
  });
});
