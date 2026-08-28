import type { Program, Rule } from '@/guidance/rules';

const SOURCE =
  'https://vancouver.calendar.ubc.ca/faculties-colleges-and-schools/faculty-science/bachelor-science/biochemistry';
const COMM =
  'https://vancouver.calendar.ubc.ca/faculties-colleges-and-schools/faculty-science/bachelor-science/communication-requirements';

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
 * Biochemistry Major (BSc), 2026W — 120 credits.
 *
 * A four-year table like Physics, and the most chemistry-heavy program here:
 * five CHEM courses across the first two years alongside the BIOC core.
 */
export const biocMajor2026W: Program = {
  code: 'bioc-major-bsc-2026w',
  name: 'Biochemistry Major',
  degree: 'BSc',
  faculty: 'Science',
  catalogYear: '2026W',
  extends: ['science-faculty-core-2026w'],
  sourceUrl: SOURCE,
  totalCredits: 120,
  rules: [
    {
      id: 'bioc.first-year',
      kind: 'group',
      label: 'First year',
      year: 1,
      sourceUrl: SOURCE,
      items: [
        course('bioc.scie113', 'SCIE 113'),
        {
          id: 'bioc.comm-additional',
          kind: 'credits',
          label: 'Communication requirement (approved list)',
          n: 3,
          from: {
            kind: 'codes',
            // The Calendar's approved list in full. The last two are marked
            // there as REQUIRED of Chemistry and Environmental Sciences
            // specializations respectively, but they are approved for anyone.
            codes: ['WRDS 150', 'ENGL 110', 'ENGL 111', 'SCIE 300', 'CHEM 300', 'ENVR 200'],
          },
          sourceUrl: COMM,
          confidence: 'stated',
        },
        course('bioc.biol112', 'BIOL 112'),
        one('bioc.chem1', 'CHEM 121, 111 or 141', ['CHEM 121', 'CHEM 111', 'CHEM 141']),
        course('bioc.chem123', 'CHEM 123'),
        one('bioc.calc1', 'Differential calculus', ['MATH 100', 'MATH 102', 'MATH 104']),
        one('bioc.computing', 'DSCI 100 or CPSC 103', ['DSCI 100', 'CPSC 103']),
        {
          id: 'bioc.phys100',
          kind: 'credits',
          label: 'PHYS at the 100 level',
          n: 3,
          from: { kind: 'pattern', subjects: ['PHYS'], levelMin: 100, levelMax: 199 },
          sourceUrl: SOURCE,
          confidence: 'stated',
        },
      ],
    },
    {
      id: 'bioc.second-year',
      kind: 'group',
      label: 'Second year',
      year: 2,
      sourceUrl: SOURCE,
      items: [
        course('bioc.203', 'BIOC 203'),
        course('bioc.biol200', 'BIOL 200'),
        course('bioc.biol234', 'BIOL 234'),
        course('bioc.chem205', 'CHEM 205'),
        course('bioc.chem203', 'CHEM 203'),
        course('bioc.chem213', 'CHEM 213'),
        course('bioc.chem245', 'CHEM 245'),
        one('bioc.stats', 'STAT 201 or CPSC 203', ['STAT 201', 'CPSC 203']),
      ],
    },
    {
      id: 'bioc.third-year',
      kind: 'group',
      label: 'Third year',
      year: 3,
      sourceUrl: SOURCE,
      items: [
        course('bioc.301', 'BIOC 301'),
        course('bioc.303', 'BIOC 303'),
        course('bioc.306', 'BIOC 306'),
        course('bioc.biol335', 'BIOL 335'),
        course('bioc.chem313', 'CHEM 313'),
      ],
    },
    {
      id: 'bioc.fourth-year',
      kind: 'group',
      label: 'Fourth year',
      year: 4,
      sourceUrl: SOURCE,
      items: [
        course('bioc.402', 'BIOC 402'),
        course('bioc.410', 'BIOC 410'),
        {
          id: 'bioc.topic',
          kind: 'chooseN',
          label: 'One of BIOC 403, 421, 430, 440, 450, 460, 470',
          n: 1,
          sourceUrl: SOURCE,
          confidence: 'stated',
          of: ['BIOC 403', 'BIOC 421', 'BIOC 430', 'BIOC 440', 'BIOC 450', 'BIOC 460', 'BIOC 470'].map(
            (code) => ({
              id: `bioc.topic.${code.replace(' ', '')}`,
              kind: 'course' as const,
              label: code,
              code,
            }),
          ),
        },
        {
          id: 'bioc.upper-elective',
          kind: 'credits',
          label: 'BIOC upper-year elective',
          n: 3,
          from: {
            kind: 'pattern',
            subjects: ['BIOC'],
            levelMin: 300,
            levelMax: 499,
            exclude: ['BIOC 301', 'BIOC 303', 'BIOC 306', 'BIOC 402', 'BIOC 410'],
          },
          sourceUrl: SOURCE,
          confidence: 'stated',
        },
      ],
    },
    // 4 + 7 + 12 + 18 across the four tables.
    { id: 'bioc.electives.y1', kind: 'credits', label: 'Electives', elective: true, n: 4, year: 1,
      from: { kind: 'codes', codes: [] }, sourceUrl: SOURCE, confidence: 'stated' },
    { id: 'bioc.electives.y2', kind: 'credits', label: 'Electives', elective: true, n: 7, year: 2,
      from: { kind: 'codes', codes: [] }, sourceUrl: SOURCE, confidence: 'stated' },
    { id: 'bioc.electives.y3', kind: 'credits', label: 'Electives', elective: true, n: 12, year: 3,
      from: { kind: 'codes', codes: [] }, sourceUrl: SOURCE, confidence: 'stated' },
    { id: 'bioc.electives.y4', kind: 'credits', label: 'Electives', elective: true, n: 18, year: 4,
      from: { kind: 'codes', codes: [] }, sourceUrl: SOURCE, confidence: 'stated' },
  ],
};
