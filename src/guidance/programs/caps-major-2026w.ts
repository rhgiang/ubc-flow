import type { Program, Rule } from '@/guidance/rules';

const SOURCE =
  'https://vancouver.calendar.ubc.ca/faculties-colleges-and-schools/faculty-science/bachelor-science/cellular-and-physiological-sciences';
const COMM =
  'https://vancouver.calendar.ubc.ca/faculties-colleges-and-schools/faculty-science/bachelor-science/communication-requirements';

const one = (id: string, label: string, codes: string[], year: number): Rule => ({
  id, kind: 'chooseN', label, n: 1, year, sourceUrl: SOURCE, confidence: 'stated',
  of: codes.map((code) => ({
    id: `${id}.${code.replace(' ', '')}`, kind: 'course' as const, label: code, code,
  })),
});

const course = (id: string, code: string, year: number): Rule => ({
  id, kind: 'course', label: code, code, year, sourceUrl: SOURCE, confidence: 'stated',
});

/** The fourth year is three courses from one list, and they are not all 3 credits. */
const CAPSTONES = ['CAPS 420', 'CAPS 421', 'CAPS 422', 'CAPS 424', 'CAPS 426', 'CAPS 427', 'CAPS 431', 'CAPS 448'];

/**
 * Major in Cellular, Anatomical and Physiological Sciences (BSc), 2026W — 120
 * credits.
 *
 * The first Science major here whose first year is not 30 credits. It is 29,
 * because the Calendar prices its chemistry at 4 credits apiece and leaves no
 * first-year electives at all; the year that follows is 31.
 */
export const capsMajor2026W: Program = {
  code: 'caps-major-bsc-2026w',
  name: 'Cellular, Anatomical and Physiological Sciences Major',
  degree: 'BSc',
  faculty: 'Science',
  catalogYear: '2026W',
  extends: ['science-faculty-core-2026w'],
  sourceUrl: SOURCE,
  totalCredits: 120,
  rules: [
    {
      id: 'caps.first-year',
      kind: 'group',
      label: 'First year',
      year: 1,
      sourceUrl: SOURCE,
      items: [
        course('caps.scie113', 'SCIE 113', 1),
        {
          id: 'caps.comm-additional',
          kind: 'credits',
          label: 'Communication requirement (approved list)',
          n: 3,
          year: 1,
          from: {
            kind: 'codes',
            codes: ['WRDS 150', 'ENGL 110', 'ENGL 111', 'SCIE 300', 'CHEM 300', 'ENVR 200'],
          },
          sourceUrl: COMM,
          confidence: 'stated',
        },
        course('caps.biol112', 'BIOL 112', 1),
        course('caps.biol121', 'BIOL 121', 1),
        one('caps.chem1', 'CHEM 121, 141 or 111', ['CHEM 121', 'CHEM 141', 'CHEM 111'], 1),
        course('caps.chem123', 'CHEM 123', 1),
        course('caps.math100', 'MATH 100', 1),
        course('caps.math101', 'MATH 101', 1),
        {
          // Footnote 5: PHYS 100 itself is the remedial course, taken only by
          // students without Physics 12, so it does not count here.
          id: 'caps.phys',
          kind: 'credits',
          label: 'PHYS at the 100 level beyond PHYS 100',
          n: 3,
          year: 1,
          from: {
            kind: 'pattern', subjects: ['PHYS'], levelMin: 100, levelMax: 199, exclude: ['PHYS 100'],
          },
          sourceUrl: SOURCE,
          confidence: 'stated',
        },
      ],
    },
    {
      id: 'caps.second-year',
      kind: 'group',
      label: 'Second year',
      year: 2,
      sourceUrl: SOURCE,
      items: [
        course('caps.biol200', 'BIOL 200', 2),
        course('caps.biol234', 'BIOL 234', 2),
        one('caps.biochem', 'BIOL 201 or BIOC 202', ['BIOL 201', 'BIOC 202'], 2),
        one('caps.stats', 'BIOL 300 or STAT 200', ['BIOL 300', 'STAT 200'], 2),
        course('caps.205', 'CAPS 205', 2),
        course('caps.206', 'CAPS 206', 2),
        {
          // The Calendar prices this row at 4 either way: CHEM 233 is 3 and
          // CHEM 235 is 1, and CHEM 203 is 4 on its own.
          id: 'caps.organic',
          kind: 'chooseN',
          label: 'CHEM 233 and 235, or CHEM 203',
          n: 1,
          year: 2,
          sourceUrl: SOURCE,
          confidence: 'stated',
          of: [
            {
              id: 'caps.organic.pair',
              kind: 'group',
              label: 'CHEM 233 and CHEM 235',
              items: [
                { id: 'caps.organic.233', kind: 'course', label: 'CHEM 233', code: 'CHEM 233' },
                { id: 'caps.organic.235', kind: 'course', label: 'CHEM 235', code: 'CHEM 235' },
              ],
            },
            { id: 'caps.organic.203', kind: 'course', label: 'CHEM 203', code: 'CHEM 203' },
          ],
        },
        course('caps.chem205', 'CHEM 205', 2),
      ],
    },
    {
      id: 'caps.third-year',
      kind: 'group',
      label: 'Third year',
      year: 3,
      sourceUrl: SOURCE,
      items: [
        course('caps.bioc302', 'BIOC 302', 3),
        course('caps.303', 'CAPS 303', 3),
        course('caps.305', 'CAPS 305', 3),
        course('caps.306', 'CAPS 306', 3),
        course('caps.310', 'CAPS 310', 3),
        course('caps.391', 'CAPS 391', 3),
      ],
    },
    {
      // "Three of the following ... 9" — the Calendar prices the row at 9, so
      // it is stated as 9 credits from the list rather than as three courses.
      // CAPS 448 is a 2-credit course, and choosing it leaves a credit to make
      // up elsewhere; a choose-3 would have hidden that.
      id: 'caps.fourth-year',
      kind: 'credits',
      label: 'Three of CAPS 420, 421, 422, 424, 426, 427, 431 or 448',
      n: 9,
      year: 4,
      from: { kind: 'codes', codes: CAPSTONES },
      sourceUrl: SOURCE,
      confidence: 'stated',
    },
    {
      id: 'caps.448',
      kind: 'note',
      label: 'CAPS 448 is a 2-credit course in a 3-credit slot',
      detail:
        'The fourth-year row is priced at 9 credits for three courses, but CAPS 448 is ' +
        'worth 2 rather than 3. Choosing it leaves a credit to make up from electives.',
      sourceUrl: SOURCE,
      confidence: 'stated',
    },
    {
      id: 'caps.substitutions',
      kind: 'note',
      label: 'Heavier alternatives reduce your elective credits',
      detail:
        'MATH 120, 180 or 184 may replace MATH 100 and reduce required electives by 1; ' +
        'MATH 110 replaces it and reduces them by 3. CHEM 211 may replace CHEM 205 and ' +
        'reduces them by 1. The plan takes the lighter option in each case, which is what ' +
        'the year totals above are priced on.',
      sourceUrl: SOURCE,
      confidence: 'stated',
    },
    {
      id: 'caps.preparation',
      kind: 'note',
      label: 'Some students need preparatory courses first',
      detail:
        'BIOL 111 is required before BIOL 112 or 121 for students without BC High School ' +
        'Biology 11 or 12. Students without Chemistry 12 must write the UBC Chemistry ' +
        'Basic Skills Test and may need CHEM 100, 110 or 111 first, and those without ' +
        'Physics 12 must take PHYS 100 before any other physics. None of these count ' +
        'toward the requirements above.',
      sourceUrl: SOURCE,
      confidence: 'stated',
    },
    // 6 in second year, 12 in third and 21 in fourth. First year has none.
    { id: 'caps.electives.y2', kind: 'credits', label: 'Electives', elective: true, n: 6, year: 2,
      from: { kind: 'codes', codes: [] }, sourceUrl: SOURCE, confidence: 'stated' },
    { id: 'caps.electives.y3', kind: 'credits', label: 'Electives', elective: true, n: 12, year: 3,
      from: { kind: 'codes', codes: [] }, sourceUrl: SOURCE, confidence: 'stated' },
    { id: 'caps.electives.y4', kind: 'credits', label: 'Electives', elective: true, n: 21, year: 4,
      from: { kind: 'codes', codes: [] }, sourceUrl: SOURCE, confidence: 'stated' },
  ],
};
