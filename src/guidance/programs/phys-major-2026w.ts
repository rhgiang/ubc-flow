import type { Program, Rule } from '@/guidance/rules';

const SOURCE =
  'https://vancouver.calendar.ubc.ca/faculties-colleges-and-schools/faculty-science/bachelor-science/physics';
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

/** PHYS or ASTR at the upper level, the shape used for both selection rows. */
const upperPhys = (id: string, label: string, n: number, exclude: string[] = []): Rule => ({
  id,
  kind: 'credits',
  label,
  n,
  from: { kind: 'pattern', subjects: ['PHYS', 'ASTR'], levelMin: 300, levelMax: 499, exclude },
  sourceUrl: SOURCE,
  confidence: 'stated',
});

/**
 * Physics Major (BSc), 2026W - 120 credits.
 *
 * The first program here whose Calendar table separates third and fourth year
 * rather than merging them, so its rules carry years 1 through 4.
 *
 * Footnote 3 is a warning worth reading: MATH 110 is 6 credits and MATH 120,
 * 121, 180 and 184 are 4, so choosing one of those shifts the elective count.
 * The alternatives are modelled; the shift is not.
 */
export const physMajor2026W: Program = {
  code: 'phys-major-bsc-2026w',
  name: 'Physics Major',
  degree: 'BSc',
  faculty: 'Science',
  catalogYear: '2026W',
  extends: ['science-faculty-core-2026w'],
  sourceUrl: SOURCE,
  totalCredits: 120,
  rules: [
    {
      id: 'phys.first-year',
      kind: 'group',
      label: 'First year',
      year: 1,
      sourceUrl: SOURCE,
      items: [
        course('phys.scie113', 'SCIE 113'),
        {
          id: 'phys.comm-additional',
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
        one('phys.chem', 'CHEM 121 or 111', ['CHEM 121', 'CHEM 111']),
        one('phys.calc1', 'Differential calculus', [
          'MATH 100', 'MATH 102', 'MATH 104', 'MATH 110', 'MATH 120', 'MATH 180', 'MATH 184',
        ]),
        one('phys.calc2', 'Integral calculus', ['MATH 101', 'MATH 103', 'MATH 105', 'MATH 121']),
        one('phys.mech', 'PHYS 117, 106 or 107', ['PHYS 117', 'PHYS 106', 'PHYS 107']),
        one('phys.em', 'PHYS 118 or 108', ['PHYS 118', 'PHYS 108']),
        one('phys.lab1', 'PHYS 119 or 109', ['PHYS 119', 'PHYS 109']),
      ],
    },
    {
      id: 'phys.second-year',
      kind: 'group',
      label: 'Second year',
      year: 2,
      sourceUrl: SOURCE,
      items: [
        // Footnote 8: qualified students may take MATH 217 with 2 elective
        // credits instead of MATH 200 and 215. Not modelled - it depends on
        // qualification, which the plan cannot assume.
        course('phys.math200', 'MATH 200'),
        course('phys.math215', 'MATH 215'),
        course('phys.math221', 'MATH 221'),
        course('phys.200', 'PHYS 200'),
        course('phys.216', 'PHYS 216'),
        course('phys.219', 'PHYS 219'),
        course('phys.229', 'PHYS 229'),
        course('phys.210', 'PHYS 210'),
      ],
    },
    {
      id: 'phys.third-year',
      kind: 'group',
      label: 'Third year',
      year: 3,
      sourceUrl: SOURCE,
      items: [
        course('phys.math317', 'MATH 317'),
        // Footnote 11: CHEM 304 may replace PHYS 203.
        one('phys.203', 'PHYS 203 or CHEM 304', ['PHYS 203', 'CHEM 304']),
        one('phys.309', 'PHYS 309 or 319', ['PHYS 309', 'PHYS 319']),
        one('phys.312', 'PHYS 312 or MATH 316', ['PHYS 312', 'MATH 316']),
        course('phys.304', 'PHYS 304'),
        upperPhys('phys.upper-y3', 'PHYS or ASTR at the 300 level and above', 3, [
          'PHYS 301', 'PHYS 304', 'PHYS 309', 'PHYS 312', 'PHYS 319', 'PHYS 348', 'PHYS 409', 'PHYS 420',
        ]),
      ],
    },
    {
      id: 'phys.fourth-year',
      kind: 'group',
      label: 'Fourth year',
      year: 4,
      sourceUrl: SOURCE,
      items: [
        course('phys.301', 'PHYS 301'),
        {
          // Footnote 13 notes more than 3 credits may be taken from these,
          // since they are variable-credit courses.
          id: 'phys.project',
          kind: 'credits',
          label: '3 credits from PHYS 348, 409 and 420',
          n: 3,
          from: { kind: 'codes', codes: ['PHYS 348', 'PHYS 409', 'PHYS 420'] },
          sourceUrl: SOURCE,
          confidence: 'stated',
        },
        upperPhys('phys.upper-y4', 'PHYS or ASTR at the 300 level and above', 9, [
          'PHYS 301', 'PHYS 304', 'PHYS 309', 'PHYS 312', 'PHYS 319', 'PHYS 348', 'PHYS 409', 'PHYS 420',
        ]),
      ],
    },
    // 7 + 8 + 11 + 15 across the four tables. Footnote 5 states the intent
    // outright: the elective count each year is whatever makes the year 30.
    { id: 'phys.electives.y1', kind: 'credits', label: 'Electives', elective: true, n: 7, year: 1,
      from: { kind: 'codes', codes: [] }, sourceUrl: SOURCE, confidence: 'stated' },
    { id: 'phys.electives.y2', kind: 'credits', label: 'Electives', elective: true, n: 8, year: 2,
      from: { kind: 'codes', codes: [] }, sourceUrl: SOURCE, confidence: 'stated' },
    { id: 'phys.electives.y3', kind: 'credits', label: 'Electives', elective: true, n: 11, year: 3,
      from: { kind: 'codes', codes: [] }, sourceUrl: SOURCE, confidence: 'stated' },
    { id: 'phys.electives.y4', kind: 'credits', label: 'Electives', elective: true, n: 15, year: 4,
      from: { kind: 'codes', codes: [] }, sourceUrl: SOURCE, confidence: 'stated' },
  ],
};
