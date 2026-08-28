import type { Program } from '@/guidance/rules';

const SOURCE =
  'https://vancouver.calendar.ubc.ca/faculties-colleges-and-schools/faculty-science/bachelor-science/computer-science';

/**
 * Computer Science Major (BSc), 2026W.
 *
 * Transcribed from the Calendar page above. Only the CPSC-specific rules live
 * here — Arts credits, breadth, residency and the rest come from
 * science-faculty-core-2026w via `extends`.
 *
 * Course codes are written without the _V campus suffix the Calendar uses,
 * because that is how they are stored in Course/Subject.
 */
export const cpscMajor2026W: Program = {
  code: 'cpsc-major-bsc-2026w',
  name: 'Computer Science Major',
  degree: 'BSc',
  faculty: 'Science',
  catalogYear: '2026W',
  extends: ['science-faculty-core-2026w'],
  sourceUrl: SOURCE,
  totalCredits: 120,
  rules: [
    {
      id: 'cpsc.first-year',
      kind: 'group',
      label: 'First year',
      sourceUrl: SOURCE,
      items: [
        {
          id: 'cpsc.scie113',
          kind: 'course',
          label: 'SCIE 113',
          code: 'SCIE 113',
          sourceUrl: SOURCE,
          confidence: 'stated',
        },
        {
          // "In addition to SCIE_V 113, B.Sc. students are required to receive
          // three credits of approved communications courses." The approved
          // list is not transcribed, so this resolves to no concrete course
          // and the solver places it as a slot — which is the right shape
          // regardless, since the student picks from a list.
          id: 'cpsc.comm-additional',
          kind: 'credits',
          label: 'Communication requirement (approved list)',
          n: 3,
          from: { kind: 'codes', codes: [] },
          sourceUrl:
            'https://vancouver.calendar.ubc.ca/faculties-colleges-and-schools/faculty-science/bachelor-science/communication-requirements',
          confidence: 'inferred',
        },
        {
          id: 'cpsc.intro',
          kind: 'chooseN',
          label: 'CPSC 110, or CPSC 103 and 107',
          n: 1,
          sourceUrl: SOURCE,
          confidence: 'stated',
          of: [
            { id: 'cpsc.intro.110', kind: 'course', label: 'CPSC 110', code: 'CPSC 110' },
            {
              id: 'cpsc.intro.103-107',
              kind: 'group',
              label: 'CPSC 103 and CPSC 107',
              items: [
                { id: 'cpsc.intro.103', kind: 'course', label: 'CPSC 103', code: 'CPSC 103' },
                { id: 'cpsc.intro.107', kind: 'course', label: 'CPSC 107', code: 'CPSC 107' },
              ],
            },
          ],
        },
        {
          id: 'cpsc.121',
          kind: 'course',
          label: 'CPSC 121',
          code: 'CPSC 121',
          sourceUrl: SOURCE,
          confidence: 'stated',
        },
        {
          id: 'cpsc.calc1',
          kind: 'chooseN',
          label: 'Differential calculus',
          n: 1,
          sourceUrl: SOURCE,
          confidence: 'stated',
          of: [
            { id: 'cpsc.calc1.100', kind: 'course', label: 'MATH 100', code: 'MATH 100' },
            { id: 'cpsc.calc1.102', kind: 'course', label: 'MATH 102', code: 'MATH 102' },
            { id: 'cpsc.calc1.104', kind: 'course', label: 'MATH 104', code: 'MATH 104' },
            { id: 'cpsc.calc1.180', kind: 'course', label: 'MATH 180', code: 'MATH 180' },
            { id: 'cpsc.calc1.184', kind: 'course', label: 'MATH 184', code: 'MATH 184' },
            { id: 'cpsc.calc1.120', kind: 'course', label: 'MATH 120', code: 'MATH 120' },
            { id: 'cpsc.calc1.110', kind: 'course', label: 'MATH 110', code: 'MATH 110' },
          ],
        },
        {
          id: 'cpsc.calc2',
          kind: 'chooseN',
          label: 'Integral calculus',
          n: 1,
          sourceUrl: SOURCE,
          confidence: 'stated',
          of: [
            { id: 'cpsc.calc2.101', kind: 'course', label: 'MATH 101', code: 'MATH 101' },
            { id: 'cpsc.calc2.103', kind: 'course', label: 'MATH 103', code: 'MATH 103' },
            { id: 'cpsc.calc2.105', kind: 'course', label: 'MATH 105', code: 'MATH 105' },
            { id: 'cpsc.calc2.121', kind: 'course', label: 'MATH 121', code: 'MATH 121' },
          ],
        },
      ],
    },
    {
      id: 'cpsc.second-year',
      kind: 'group',
      label: 'Second year',
      sourceUrl: SOURCE,
      items: [
        { id: 'cpsc.210', kind: 'course', label: 'CPSC 210', code: 'CPSC 210', sourceUrl: SOURCE, confidence: 'stated' },
        { id: 'cpsc.213', kind: 'course', label: 'CPSC 213', code: 'CPSC 213', sourceUrl: SOURCE, confidence: 'stated' },
        { id: 'cpsc.221', kind: 'course', label: 'CPSC 221', code: 'CPSC 221', sourceUrl: SOURCE, confidence: 'stated' },
        {
          id: 'cpsc.linalg',
          kind: 'chooseN',
          label: 'Linear algebra',
          n: 1,
          sourceUrl: SOURCE,
          confidence: 'stated',
          of: [
            { id: 'cpsc.linalg.111', kind: 'course', label: 'MATH 111', code: 'MATH 111' },
            { id: 'cpsc.linalg.221', kind: 'course', label: 'MATH 221', code: 'MATH 221' },
          ],
        },
        { id: 'cpsc.math200', kind: 'course', label: 'MATH 200', code: 'MATH 200', sourceUrl: SOURCE, confidence: 'stated' },
        {
          id: 'cpsc.stat',
          kind: 'chooseN',
          label: 'Statistics',
          n: 1,
          sourceUrl: SOURCE,
          // The Calendar allows STAT 200/201 to replace STAT 251 under
          // conditions it states on a linked page; the alternatives are
          // recorded, the conditions are not.
          confidence: 'inferred',
          of: [
            { id: 'cpsc.stat.251', kind: 'course', label: 'STAT 251', code: 'STAT 251' },
            { id: 'cpsc.stat.200', kind: 'course', label: 'STAT 200', code: 'STAT 200' },
            { id: 'cpsc.stat.201', kind: 'course', label: 'STAT 201', code: 'STAT 201' },
          ],
        },
      ],
    },
    {
      // The Calendar's own rows: Electives 10 / 9 / 32 credits across the four
      // years. Omitting them left the plan 51 credits short of the 120 the
      // degree requires, which is why it finished a year early. Kept as one
      // rule rather than three, because the same page notes that "students are
      // permitted to move elective credits between years" — splitting them by
      // year would impose an ordering the Calendar explicitly does not.
      id: 'cpsc.electives',
      kind: 'credits',
      label: 'Electives',
      n: 51,
      from: { kind: 'codes', codes: [] },
      sourceUrl: SOURCE,
      confidence: 'stated',
    },
    {
      id: 'cpsc.upper-years',
      kind: 'group',
      label: 'Third and fourth years',
      sourceUrl: SOURCE,
      items: [
        { id: 'cpsc.310', kind: 'course', label: 'CPSC 310', code: 'CPSC 310', sourceUrl: SOURCE, confidence: 'stated' },
        { id: 'cpsc.313', kind: 'course', label: 'CPSC 313', code: 'CPSC 313', sourceUrl: SOURCE, confidence: 'stated' },
        { id: 'cpsc.320', kind: 'course', label: 'CPSC 320', code: 'CPSC 320', sourceUrl: SOURCE, confidence: 'stated' },
        {
          id: 'cpsc.upper300',
          kind: 'credits',
          label: '9 credits of CPSC or AI numbered 300 or higher',
          n: 9,
          from: {
            kind: 'pattern',
            subjects: ['CPSC', 'AI'],
            levelMin: 300,
            // Capped for the same reason as the 400-level rule below: 500 and
            // above are graduate courses, and a roadmap should not fill an
            // undergraduate's electives with them.
            levelMax: 499,
            // The three named upper-level courses above cannot also count here.
            exclude: ['CPSC 310', 'CPSC 313', 'CPSC 320'],
          },
          sourceUrl: SOURCE,
          confidence: 'stated',
        },
        {
          id: 'cpsc.upper400',
          kind: 'credits',
          label: '9 credits of CPSC or AI numbered 400 or higher',
          n: 9,
          // Capped at 499. The Calendar says "400 or higher" and the Faculty
          // core separately allows at most 6 credits numbered 500+, but a
          // roadmap that fills a student's fourth year with graduate seminars
          // is wrong in practice — 500-level is an advised exception, not a
          // default the solver should reach for.
          from: { kind: 'pattern', subjects: ['CPSC', 'AI'], levelMin: 400, levelMax: 499 },
          sourceUrl: SOURCE,
          confidence: 'stated',
        },
        {
          id: 'cpsc.upper400-lecture',
          kind: 'note',
          label: 'At least 3 of the 400-level credits must be lecture-based',
          detail:
            'The Calendar requires at least 3 credits of the 400-level requirement to ' +
            'come from lecture-based courses. Nothing in the catalogue data marks a ' +
            'course as lecture-based, so this cannot be evaluated here.',
          sourceUrl: SOURCE,
          confidence: 'stated',
        },
      ],
    },
  ],
};
