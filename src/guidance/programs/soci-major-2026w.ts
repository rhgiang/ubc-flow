import type { Program, Rule } from '@/guidance/rules';

const SOURCE =
  'https://vancouver.calendar.ubc.ca/faculties-colleges-and-schools/faculty-arts/bachelor-arts/sociology';

const one = (id: string, label: string, codes: string[], year: number): Rule => ({
  id, kind: 'chooseN', label, n: 1, year, sourceUrl: SOURCE, confidence: 'stated',
  of: codes.map((code) => ({
    id: `${id}.${code.replace(' ', '')}`, kind: 'course' as const, label: code, code,
  })),
});

const course = (id: string, code: string, year: number): Rule => ({
  id, kind: 'course', label: code, code, year, sourceUrl: SOURCE, confidence: 'stated',
});

/**
 * Major in Sociology (B.A.), 2026W - 42 credits toward a 120-credit degree.
 *
 * 12 credits at the 100 and 200 level and 30 above it, which is the Faculty's
 * Major shape exactly. The theory requirements carry a wrinkle: SOCI 370 is a
 * single 6-credit course covering both classical and contemporary theory, and
 * so satisfies two of the rules below at once. It is left out of both choices
 * and recorded as a note, because a course is spent once here - offering it
 * in both places would have it fill one and leave the other looking
 * outstanding.
 */
export const sociMajor2026W: Program = {
  code: 'soci-major-ba-2026w',
  name: 'Sociology Major',
  degree: 'BA',
  faculty: 'Arts',
  catalogYear: '2026W',
  extends: ['arts-faculty-core-2026w'],
  sourceUrl: SOURCE,
  totalCredits: 120,
  rules: [
    {
      id: 'soci.lower',
      kind: 'group',
      label: 'Lower-level requirements: 12 credits of SOCI at 100 and 200 level',
      sourceUrl: SOURCE,
      items: [
        // "At least 3 credits from SOCI_V 100, 101, or 102". SOCI 100 is a
        // 6-credit course, so it fills half the 12 on its own; the 3-credit
        // options are listed first so the plan reserves what the rule
        // actually asks for.
        one('soci.intro', 'SOCI 101, 102 or 100', ['SOCI 101', 'SOCI 102', 'SOCI 100'], 1),
        course('soci.217', 'SOCI 217', 2),
        {
          id: 'soci.lower-additional',
          kind: 'credits',
          label: 'Further SOCI at the 100 or 200 level',
          n: 6,
          year: 2,
          from: {
            kind: 'pattern',
            subjects: ['SOCI'],
            levelMin: 100,
            levelMax: 299,
            exclude: ['SOCI 100', 'SOCI 101', 'SOCI 102', 'SOCI 217'],
          },
          sourceUrl: SOURCE,
          confidence: 'stated',
        },
      ],
    },
    {
      id: 'soci.upper',
      kind: 'group',
      label: 'Upper-level requirements',
      year: 3,
      sourceUrl: SOURCE,
      items: [
        course('soci.310', 'SOCI 310', 3),
        course('soci.328', 'SOCI 328', 3),
        one('soci.classical', 'Classical sociological theory', ['SOCI 371'], 3),
        one(
          'soci.contemporary',
          'Contemporary sociological theory',
          ['SOCI 372', 'SOCI 414', 'SOCI 415', 'SOCI 416', 'SOCI 469'],
          3,
        ),
        one(
          'soci.methods',
          'Advanced research methods',
          ['SOCI 380', 'SOCI 381', 'SOCI 382', 'SOCI 383'],
          3,
        ),
        {
          id: 'soci.upper-additional',
          kind: 'credits',
          label: 'Further SOCI at the 300 or 400 level',
          n: 15,
          year: 4,
          from: {
            kind: 'pattern',
            subjects: ['SOCI'],
            levelMin: 300,
            levelMax: 499,
            exclude: ['SOCI 310', 'SOCI 328', 'SOCI 370', 'SOCI 371', 'SOCI 372'],
          },
          sourceUrl: SOURCE,
          confidence: 'stated',
        },
      ],
    },
    {
      id: 'soci.370',
      kind: 'note',
      label: 'SOCI 370 covers both theory requirements at once',
      detail:
        'SOCI 370 is a 6-credit course spanning classical and contemporary sociological ' +
        'theory, and satisfies both of the 3-credit theory rules above on its own. Taking ' +
        'it instead of SOCI 371 plus a contemporary course costs the same 6 credits.',
      sourceUrl: SOURCE,
      confidence: 'stated',
    },
    {
      id: 'soci.research-component',
      kind: 'note',
      label: 'Research Component: met by the advanced research methods course',
      detail:
        'The Faculty of Arts Research Component names SOCI 380, 381, 382, 383 and 449 for ' +
        'this major. The advanced research methods requirement above already draws from ' +
        'that list, so it costs no additional credits.',
      sourceUrl: SOURCE,
      confidence: 'stated',
    },
    // 42 credits of major and 3 of the Faculty's Writing Component leave 75.
    { id: 'soci.electives.y1', kind: 'credits', label: 'Electives', elective: true, n: 24, year: 1,
      from: { kind: 'codes', codes: [] }, sourceUrl: SOURCE, confidence: 'stated' },
    { id: 'soci.electives.y2', kind: 'credits', label: 'Electives', elective: true, n: 21, year: 2,
      from: { kind: 'codes', codes: [] }, sourceUrl: SOURCE, confidence: 'stated' },
    { id: 'soci.electives.y3', kind: 'credits', label: 'Electives', elective: true, n: 15, year: 3,
      from: { kind: 'codes', codes: [] }, sourceUrl: SOURCE, confidence: 'stated' },
    { id: 'soci.electives.y4', kind: 'credits', label: 'Electives', elective: true, n: 15, year: 4,
      from: { kind: 'codes', codes: [] }, sourceUrl: SOURCE, confidence: 'stated' },
  ],
};
