import type { Program, Rule } from '@/guidance/rules';

const SOURCE =
  'https://vancouver.calendar.ubc.ca/faculties-colleges-and-schools/vancouver-school-economics/bachelor-arts-economics';

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
 * Major in Economics (B.A.), 2026W - 42 ECON credits toward a 120-credit
 * degree, plus the calculus needed to be admitted.
 *
 * The only Arts major here that does not live in the Faculty of Arts section
 * of the Calendar: Economics is the Vancouver School of Economics, and its
 * page is cited instead.
 *
 * The differential calculus course is an admission requirement rather than a
 * program requirement, so it sits outside the 42. It is planned anyway,
 * because leaving it out would produce a roadmap for a program the student
 * could not be admitted to.
 */
export const econMajor2026W: Program = {
  code: 'econ-major-ba-2026w',
  name: 'Economics Major',
  degree: 'BA',
  faculty: 'Arts',
  catalogYear: '2026W',
  extends: ['arts-faculty-core-2026w'],
  sourceUrl: SOURCE,
  totalCredits: 120,
  rules: [
    {
      id: 'econ.admission',
      kind: 'group',
      label: 'Admission requirements',
      year: 1,
      sourceUrl: SOURCE,
      items: [
        one(
          'econ.calculus',
          'Differential calculus',
          ['MATH 104', 'MATH 100', 'MATH 102', 'MATH 110', 'MATH 120', 'MATH 180', 'MATH 184'],
          1,
        ),
        {
          id: 'econ.admission-note',
          kind: 'note',
          label: 'Admission is by application and is not automatic',
          detail:
            'Students are normally admitted on attaining Year 2 standing (27 credits), by ' +
            'written application to the School. Meeting the minimum requirements does not ' +
            'guarantee a place. The Writing Component of the B.A. also counts toward ' +
            'admission, and SCIE 001 may replace the calculus course.',
          sourceUrl: SOURCE,
          confidence: 'stated',
        },
      ],
    },
    {
      id: 'econ.lower',
      kind: 'group',
      label: 'Lower-level requirements',
      sourceUrl: SOURCE,
      items: [
        course('econ.101', 'ECON 101', 1),
        course('econ.102', 'ECON 102', 1),
        {
          id: 'econ.200-level',
          kind: 'credits',
          label: 'ECON numbered 200 or above',
          n: 3,
          year: 2,
          from: { kind: 'pattern', subjects: ['ECON'], levelMin: 200, levelMax: 499, exclude: ['ECON 325'] },
          sourceUrl: SOURCE,
          confidence: 'stated',
        },
        course('econ.325', 'ECON 325', 2),
      ],
    },
    {
      id: 'econ.upper',
      kind: 'group',
      label: 'Upper-level requirements',
      year: 3,
      sourceUrl: SOURCE,
      items: [
        one('econ.micro', 'ECON 301 or 304', ['ECON 301', 'ECON 304'], 3),
        one('econ.macro', 'ECON 302 or 305', ['ECON 302', 'ECON 305'], 3),
        course('econ.326', 'ECON 326', 3),
        {
          id: 'econ.electives-300',
          kind: 'credits',
          label: 'ECON electives numbered 300 or above',
          n: 6,
          year: 3,
          from: {
            kind: 'pattern', subjects: ['ECON'], levelMin: 300, levelMax: 499,
            exclude: ['ECON 301', 'ECON 302', 'ECON 304', 'ECON 305', 'ECON 326', 'ECON 490'],
          },
          sourceUrl: SOURCE,
          confidence: 'stated',
        },
        // The senior research seminar, restricted to Majors and Combined
        // Majors in their final session. All of ECON 301, 302, 325 and 326
        // must be finished first, which is why it sits in fourth year.
        course('econ.490', 'ECON 490', 4),
        {
          id: 'econ.electives-400',
          kind: 'credits',
          label: 'ECON electives numbered 400 or above',
          n: 12,
          year: 4,
          // Footnote 1: ECON 457 does not count toward the 400-level electives.
          from: {
            kind: 'pattern', subjects: ['ECON'], levelMin: 400, levelMax: 499,
            exclude: ['ECON 457', 'ECON 490'],
          },
          sourceUrl: SOURCE,
          confidence: 'stated',
        },
      ],
    },
    {
      id: 'econ.totals',
      kind: 'note',
      label: '42 ECON credits, of which 30 numbered 300 or above',
      detail:
        'Economics course numbers reflect analytical sophistication rather than year ' +
        'level. Unassigned first-year transfer credit (ECON 1st) and anything taken ' +
        'Credit/D/Fail may not count toward the 42. A number of approved substitutes ' +
        'exist for the statistics requirements, STAT 200 for ECON 325 among them, but ' +
        'substituting outside ECON means taking a further ECON course to keep the total.',
      sourceUrl: SOURCE,
      confidence: 'stated',
    },
    {
      id: 'econ.continuation',
      kind: 'note',
      label: 'Continuation: ECON 301, ECON 325 and calculus by 45 credits',
      detail:
        'On completing 45 credits a student must have finished one of MATH 101, 103, 105, ' +
        '121 or SCIE 001, plus ECON 301 and ECON 325 or approved substitutes, and hold a ' +
        '60% average in ECON courses. Falling short can mean being required to leave the ' +
        'major.',
      sourceUrl: SOURCE,
      confidence: 'stated',
    },
    {
      id: 'econ.research-component',
      kind: 'note',
      label: 'Research Component: met by ECON 490',
      detail:
        'The Faculty of Arts Research Component names ECON 390, 490, 495 and 499 for this ' +
        'major. ECON 490 is already required above as the senior research seminar, so it ' +
        'costs no additional credits.',
      sourceUrl: SOURCE,
      confidence: 'stated',
    },
    // 42 credits of major, 3 of calculus and 3 of the Writing Component leave 72.
    { id: 'econ.electives.y1', kind: 'credits', label: 'Electives', elective: true, n: 18, year: 1,
      from: { kind: 'codes', codes: [] }, sourceUrl: SOURCE, confidence: 'stated' },
    { id: 'econ.electives.y2', kind: 'credits', label: 'Electives', elective: true, n: 24, year: 2,
      from: { kind: 'codes', codes: [] }, sourceUrl: SOURCE, confidence: 'stated' },
    { id: 'econ.electives.y3', kind: 'credits', label: 'Electives', elective: true, n: 15, year: 3,
      from: { kind: 'codes', codes: [] }, sourceUrl: SOURCE, confidence: 'stated' },
    { id: 'econ.electives.y4', kind: 'credits', label: 'Electives', elective: true, n: 15, year: 4,
      from: { kind: 'codes', codes: [] }, sourceUrl: SOURCE, confidence: 'stated' },
  ],
};
