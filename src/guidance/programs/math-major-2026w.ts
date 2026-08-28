import type { Program, Rule } from '@/guidance/rules';

const SOURCE =
  'https://vancouver.calendar.ubc.ca/faculties-colleges-and-schools/faculty-science/bachelor-science/mathematics';
const COMM =
  'https://vancouver.calendar.ubc.ca/faculties-colleges-and-schools/faculty-science/bachelor-science/communication-requirements';

const one = (id: string, label: string, codes: string[]): Rule => ({
  id,
  kind: 'chooseN',
  label,
  n: 1,
  sourceUrl: SOURCE,
  confidence: 'stated',
  of: codes.map((code) => ({
    id: `${id}.${code.replace(' ', '')}`,
    kind: 'course' as const,
    label: code,
    code,
  })),
});

const course = (id: string, code: string): Rule => ({
  id,
  kind: 'course',
  label: code,
  code,
  sourceUrl: SOURCE,
  confidence: 'stated',
});

/**
 * Mathematics Major (BSc), 2026W — 120 credits.
 *
 * The Calendar prints Honours, the Mathematical Sciences major, areas of
 * concentration and a dual degree on the same page; this is the Major table.
 *
 * Only the MATH-specific rules are here. Arts credits, Science Breadth,
 * residency and the non-Science cap come from science-faculty-core-2026w
 * through `extends` — the third program to reuse that core unchanged.
 */
export const mathMajor2026W: Program = {
  code: 'math-major-bsc-2026w',
  name: 'Mathematics Major',
  degree: 'BSc',
  faculty: 'Science',
  catalogYear: '2026W',
  extends: ['science-faculty-core-2026w'],
  sourceUrl: SOURCE,
  totalCredits: 120,
  rules: [
    {
      id: 'math.first-year',
      kind: 'group',
      label: 'First year',
      year: 1,
      sourceUrl: SOURCE,
      items: [
        course('math.scie113', 'SCIE 113'),
        {
          id: 'math.comm-additional',
          kind: 'credits',
          label: 'Communication requirement (approved list)',
          n: 3,
          from: { kind: 'codes', codes: [] },
          sourceUrl: COMM,
          confidence: 'inferred',
        },
        // Footnote 2 also allows MATH 110 in place of any of these, and
        // footnote 3 notes a 4-credit substitute shifts elective credits.
        // The alternatives are modelled; the credit shift is not.
        one('math.calc1', 'Differential calculus', [
          'MATH 100', 'MATH 102', 'MATH 104', 'MATH 120', 'MATH 180', 'MATH 184', 'MATH 110',
        ]),
        one('math.calc2', 'Integral calculus', ['MATH 101', 'MATH 103', 'MATH 105', 'MATH 121']),
        {
          id: 'math.phys100',
          kind: 'credits',
          label: 'PHYS at the 100 level',
          n: 3,
          from: { kind: 'pattern', subjects: ['PHYS'], levelMin: 100, levelMax: 199 },
          sourceUrl: SOURCE,
          confidence: 'stated',
        },
        {
          id: 'math.intro',
          kind: 'chooseN',
          label: 'CPSC 110, or CPSC 103 and 107',
          n: 1,
          sourceUrl: SOURCE,
          confidence: 'stated',
          of: [
            { id: 'math.intro.110', kind: 'course', label: 'CPSC 110', code: 'CPSC 110' },
            {
              id: 'math.intro.103-107',
              kind: 'group',
              label: 'CPSC 103 and CPSC 107',
              items: [
                { id: 'math.intro.103', kind: 'course', label: 'CPSC 103', code: 'CPSC 103' },
                { id: 'math.intro.107', kind: 'course', label: 'CPSC 107', code: 'CPSC 107' },
              ],
            },
          ],
        },
      ],
    },
    {
      id: 'math.second-year',
      kind: 'group',
      label: 'Second year',
      year: 2,
      sourceUrl: SOURCE,
      items: [
        one('math.calc3', 'MATH 200 or 226', ['MATH 200', 'MATH 226']),
        course('math.math220', 'MATH 220'),
        one('math.linalg', 'MATH 111, or one of 131, 221, 223', [
          'MATH 111', 'MATH 131', 'MATH 221', 'MATH 223',
        ]),
        course('math.math215', 'MATH 215'),
        // MATH 210 is listed first deliberately. The Calendar's table costs
        // this row 3 credits, which is MATH 210's weight; CPSC 210 is a
        // 4-credit course and footnote 3 says taking it decreases elective
        // credits by one. Leading with the 3-credit option keeps the file's
        // arithmetic equal to the Calendar's own.
        one('math.prog', 'MATH 210 or CPSC 210', ['MATH 210', 'CPSC 210']),
      ],
    },
    {
      id: 'math.upper-years',
      kind: 'group',
      label: 'Third and fourth years',
      year: 3,
      sourceUrl: SOURCE,
      items: [
        {
          id: 'math.upper-math',
          kind: 'credits',
          label: '24 credits of MATH numbered 300 or higher',
          n: 24,
          from: { kind: 'pattern', subjects: ['MATH'], levelMin: 300, levelMax: 499 },
          sourceUrl: SOURCE,
          confidence: 'stated',
        },
        {
          id: 'math.upper-any',
          kind: 'credits',
          label: '6 credits of MATH, STAT, CPSC or AI numbered 300 or higher',
          n: 6,
          from: {
            kind: 'pattern',
            subjects: ['MATH', 'STAT', 'CPSC', 'AI'],
            levelMin: 300,
            levelMax: 499,
          },
          sourceUrl: SOURCE,
          confidence: 'stated',
        },
      ],
    },
    // 11 + 15 + 30 across the three tables, kept per year so they spread the
    // way the Calendar intends rather than by a solver heuristic.
    { id: 'math.electives.y1', kind: 'credits', label: 'Electives', elective: true, n: 11, year: 1,
      from: { kind: 'codes', codes: [] }, sourceUrl: SOURCE, confidence: 'stated' },
    { id: 'math.electives.y2', kind: 'credits', label: 'Electives', elective: true, n: 15, year: 2,
      from: { kind: 'codes', codes: [] }, sourceUrl: SOURCE, confidence: 'stated' },
    { id: 'math.electives.y34', kind: 'credits', label: 'Electives', elective: true, n: 30, year: 3,
      from: { kind: 'codes', codes: [] }, sourceUrl: SOURCE, confidence: 'stated' },
  ],
};
