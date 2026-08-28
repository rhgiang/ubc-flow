import type { Program, Rule } from '@/guidance/rules';

const SOURCE =
  'https://vancouver.calendar.ubc.ca/faculties-colleges-and-schools/faculty-science/bachelor-science/chemistry';

const one = (id: string, label: string, codes: string[]): Rule => ({
  id, kind: 'chooseN', label, n: 1, sourceUrl: SOURCE, confidence: 'stated',
  of: codes.map((code) => ({
    id: `${id}.${code.replace(' ', '')}`, kind: 'course' as const, label: code, code,
  })),
});

const course = (id: string, code: string): Rule => ({
  id, kind: 'course', label: code, code, sourceUrl: SOURCE, confidence: 'stated',
});

/**
 * Chemistry Major (BSc), 2026W — 120 credits.
 *
 * The only program here whose first-year table has no Additional
 * Communication Requirement row. SCIE 113 is listed, the extra three credits
 * are not, and the year still sums to 30 — the footnote on electives carries
 * it instead, saying they must together fulfil the Faculty's requirements.
 * No separate rule is added for it, because adding one would push the
 * program past 120.
 */
export const chemMajor2026W: Program = {
  code: 'chem-major-bsc-2026w',
  name: 'Chemistry Major',
  degree: 'BSc',
  faculty: 'Science',
  catalogYear: '2026W',
  extends: ['science-faculty-core-2026w'],
  sourceUrl: SOURCE,
  totalCredits: 120,
  rules: [
    {
      id: 'chem.first-year',
      kind: 'group',
      label: 'First year',
      year: 1,
      sourceUrl: SOURCE,
      items: [
        course('chem.scie113', 'SCIE 113'),
        one('chem.chem1', 'CHEM 121, 111 or 141', ['CHEM 121', 'CHEM 111', 'CHEM 141']),
        course('chem.chem123', 'CHEM 123'),
        one('chem.calc1', 'Differential calculus', ['MATH 100', 'MATH 102', 'MATH 104']),
        one('chem.calc2', 'Integral calculus', ['MATH 101', 'MATH 103', 'MATH 105']),
        {
          id: 'chem.phys100',
          kind: 'credits',
          label: 'PHYS at the 100 level',
          n: 6,
          from: { kind: 'pattern', subjects: ['PHYS'], levelMin: 100, levelMax: 199 },
          sourceUrl: SOURCE,
          confidence: 'stated',
        },
      ],
    },
    {
      id: 'chem.second-year',
      kind: 'group',
      label: 'Second year',
      year: 2,
      sourceUrl: SOURCE,
      items: [
        course('chem.203', 'CHEM 203'),
        course('chem.208', 'CHEM 208'),
        course('chem.211', 'CHEM 211'),
        // The Calendar prices this pair at 4 credits together: 213 is 3 and
        // 245 is 1.
        course('chem.213', 'CHEM 213'),
        course('chem.245', 'CHEM 245'),
        course('chem.218', 'CHEM 218'),
        course('chem.math200', 'MATH 200'),
        one('chem.math-stat', 'MATH 111, 221 or STAT 200', ['MATH 111', 'MATH 221', 'STAT 200']),
      ],
    },
    {
      id: 'chem.upper-years',
      kind: 'group',
      label: 'Third and fourth years',
      year: 3,
      sourceUrl: SOURCE,
      items: [
        one('chem.biochem', 'BIOL 201 or BIOC 202', ['BIOL 201', 'BIOC 202']),
        course('chem.300', 'CHEM 300'),
        course('chem.304', 'CHEM 304'),
        course('chem.311', 'CHEM 311'),
        course('chem.312', 'CHEM 312'),
        // Another pair priced together at 4: 325 and 345 are 2 each.
        course('chem.325', 'CHEM 325'),
        course('chem.345', 'CHEM 345'),
        {
          id: 'chem.two-of',
          kind: 'chooseN',
          label: 'Two of CHEM 305, 313, 318, 327, 330, 412',
          n: 2,
          sourceUrl: SOURCE,
          confidence: 'stated',
          of: ['CHEM 305', 'CHEM 313', 'CHEM 318', 'CHEM 327', 'CHEM 330', 'CHEM 412'].map((code) => ({
            id: `chem.two-of.${code.replace(' ', '')}`,
            kind: 'course' as const,
            label: code,
            code,
          })),
        },
        course('chem.445', 'CHEM 445'),
        {
          id: 'chem.upper-electives',
          kind: 'credits',
          label: 'CHEM electives',
          n: 12,
          from: {
            kind: 'pattern',
            subjects: ['CHEM'],
            levelMin: 300,
            levelMax: 499,
            exclude: [
              'CHEM 300', 'CHEM 304', 'CHEM 311', 'CHEM 312', 'CHEM 325', 'CHEM 345',
              'CHEM 305', 'CHEM 313', 'CHEM 318', 'CHEM 327', 'CHEM 330', 'CHEM 412', 'CHEM 445',
            ],
          },
          sourceUrl: SOURCE,
          confidence: 'stated',
        },
      ],
    },
    // 7 + 6 + 20 across the three tables.
    { id: 'chem.electives.y1', kind: 'credits', label: 'Electives', elective: true, n: 7, year: 1,
      from: { kind: 'codes', codes: [] }, sourceUrl: SOURCE, confidence: 'stated' },
    { id: 'chem.electives.y2', kind: 'credits', label: 'Electives', elective: true, n: 6, year: 2,
      from: { kind: 'codes', codes: [] }, sourceUrl: SOURCE, confidence: 'stated' },
    { id: 'chem.electives.y34', kind: 'credits', label: 'Electives', elective: true, n: 20, year: 3,
      from: { kind: 'codes', codes: [] }, sourceUrl: SOURCE, confidence: 'stated' },
  ],
};
