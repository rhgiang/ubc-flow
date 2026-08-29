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

  // Real bodies pulled verbatim from the live UBC catalogue (fix round 1):
  // a lowercase "corequisite:" or "co-req:" mid-sentence must NOT be treated
  // as a new clause boundary, or the real clause gets truncated / its course
  // codes silently dropped.

  it('MICB 402: does not truncate prereqText at a mid-sentence "corequisite:" mention', () => {
    const MICB402 =
      '<p>Molecular basis of lymphocyte development, activation and adhesion; ' +
      'immunogenetics and the major histocompatibility complex. Consult the ' +
      'credit exclusion list within the Faculty of Science section of the ' +
      'calendar. [3-0-1]<i> Prerequisite: </i>One of MICB 302, BIOT 380. If ' +
      'MICB 302 is used as the prerequisite for MICB 402, students are ' +
      'required to take one of the following as a corequisite: BIOL 234, ' +
      'BIOL 335, MICB 325.</p>';
    const r = parseBody(MICB402);
    expect(r.prereqText).toContain('BIOL 234');
  });

  it('DHYG 412: does not discard the course code after an embedded "Prerequisite: Pre or Corequisite:" label', () => {
    const DHYG412 =
      '<p>Critical analysis of health care trends and oral health care ' +
      'delivery with emphasis on underserved diverse populations.<i> ' +
      'Prerequisite: </i>Pre or Corequisite: DHYG 462</p>';
    const r = parseBody(DHYG412);
    expect(r.prereqText).toContain('DHYG 462');
  });

  it('UFOR 300: does not discard the course code after an embedded "Prerequisite: Pre-req or co-req:" label', () => {
    const UFOR300 =
      '<p>Principles and practices of individual urban tree management with ' +
      'emphasis on underlying biological and ecological concepts, ' +
      'plant-environment interactions above and below ground and ' +
      'implications for establishment, evaluation, and conservation of ' +
      'individual trees in a variety of urban situations. [3-1-0]<i> ' +
      'Prerequisite: </i>Pre-req or co-req:  UFOR 316 and Third-year ' +
      'standing.</p>';
    const r = parseBody(UFOR300);
    expect(r.prereqText).toContain('UFOR 316');
  });
});

import { presentableDescription } from '../src/scrape/parse-body';

describe('presentableDescription', () => {
  it('parses a staged raw-HTML body down to the description alone', () => {
    const staged = '<p>Intro to things. Prerequisite: MATH 100. Corequisite: PHYS 101.</p>';
    expect(presentableDescription(staged)).toBe('Intro to things.');
  });
  it('passes an already-clean description through untouched', () => {
    expect(presentableDescription('Plain text stays.')).toBe('Plain text stays.');
  });
  it('handles null', () => {
    expect(presentableDescription(null)).toBeNull();
  });
});
