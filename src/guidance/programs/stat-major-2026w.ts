import type { Program, Rule } from '@/guidance/rules';

const SOURCE =
  'https://vancouver.calendar.ubc.ca/faculties-colleges-and-schools/faculty-science/bachelor-science/statistics';
const COMM =
  'https://vancouver.calendar.ubc.ca/faculties-colleges-and-schools/faculty-science/bachelor-science/communication-requirements';

/**
 * Courses that count toward the thematic concentration (footnote 7).
 *
 * The Calendar prints a table of these by subject. It includes some courses
 * numbered below 300 — COMM 290 and 291, FRST 231, PSYC 218 — but the
 * requirement itself reads "Thematic concentration courses numbered 300 or
 * above", so those cannot satisfy it and are left out here rather than
 * offered to a student who would then find them rejected.
 *
 * "Statistics | STAT_V courses" in that table is not enumerable as codes; it
 * is covered by the STAT 300+ and 400+ rules a student is taking anyway.
 */
const THEMATIC = [
  'ANTH 418', 'ANTH 527', 'ANTH 528',
  'BIOL 300', 'BIOL 301',
  'COMM 411', 'COMM 581', 'COMM 582', 'COMM 583', 'COMM 682', 'COMM 684',
  'ECON 325', 'ECON 326', 'ECON 425', 'ECON 426', 'ECON 526', 'ECON 527',
  'EPSE 482', 'EPSE 483', 'EPSE 484', 'EPSE 592', 'EPSE 596', 'EPSE 597', 'EPSE 682',
  'FRST 430', 'FRST 530', 'FRST 531', 'FRST 533', 'FRST 539',
  'GEOG 374',
  'KIN 371',
  'MATH 302', 'MATH 303', 'MATH 418', 'MATH 419', 'MATH 544', 'MATH 545', 'MATH 608',
  'PCTH 404', 'PCTH 512',
  'PHYS 509',
  'POLI 380', 'POLI 381',
  'PSYC 359', 'PSYC 366', 'PSYC 545',
  'SOCI 418',
  'WOOD 335',
];

const one = (id: string, label: string, codes: string[], confidence: 'stated' | 'inferred' = 'stated'): Rule => ({
  id,
  kind: 'chooseN',
  label,
  n: 1,
  sourceUrl: SOURCE,
  confidence,
  of: codes.map((code) => ({ id: `${id}.${code.replace(' ', '')}`, kind: 'course' as const, label: code, code })),
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
 * Statistics Major (BSc), 2026W — 120 credits.
 *
 * The Calendar prints the Honours variant on the same page at 132 credits;
 * this is the Major table only.
 *
 * Only the STAT-specific rules live here. Arts credits, Science Breadth,
 * residency and the non-Science cap all come from science-faculty-core-2026w
 * through `extends`, which is what makes a second Science program a data file
 * rather than a copy of the faculty's breadth modelling.
 */
export const statMajor2026W: Program = {
  code: 'stat-major-bsc-2026w',
  name: 'Statistics Major',
  degree: 'BSc',
  faculty: 'Science',
  catalogYear: '2026W',
  extends: ['science-faculty-core-2026w'],
  sourceUrl: SOURCE,
  totalCredits: 120,
  rules: [
    {
      id: 'stat.first-year',
      kind: 'group',
      label: 'First year',
      year: 1,
      sourceUrl: SOURCE,
      items: [
        course('stat.scie113', 'SCIE 113'),
        {
          id: 'stat.comm-additional',
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
        {
          id: 'stat.intro',
          kind: 'chooseN',
          label: 'CPSC 110, or CPSC 103 and 107',
          n: 1,
          sourceUrl: SOURCE,
          confidence: 'stated',
          of: [
            { id: 'stat.intro.110', kind: 'course', label: 'CPSC 110', code: 'CPSC 110' },
            {
              id: 'stat.intro.103-107',
              kind: 'group',
              label: 'CPSC 103 and CPSC 107',
              items: [
                { id: 'stat.intro.103', kind: 'course', label: 'CPSC 103', code: 'CPSC 103' },
                { id: 'stat.intro.107', kind: 'course', label: 'CPSC 107', code: 'CPSC 107' },
              ],
            },
          ],
        },
        course('stat.dsci100', 'DSCI 100'),
        // Footnotes 3 and 4 name the bracketed alternatives as substitutions
        // that shift elective credits by a credit or two. The alternatives are
        // modelled; the elective adjustment is not, so a student taking one is
        // a credit off in the total.
        one('stat.calc1', 'Differential calculus', [
          'MATH 100', 'MATH 102', 'MATH 104', 'MATH 120', 'MATH 180', 'MATH 184',
        ]),
        one('stat.calc2', 'Integral calculus', ['MATH 101', 'MATH 103', 'MATH 105', 'MATH 121']),
        {
          id: 'stat.combo-note',
          kind: 'note',
          label: 'A 6-credit pair may substitute for a 4-credit requirement',
          detail:
            'Footnote 2: a 6-credit combination of two courses may substitute for a ' +
            '4-credit course, decreasing elective credits by 2. Not modelled, so the ' +
            'plan shows the 4-credit route.',
          sourceUrl: SOURCE,
          confidence: 'stated',
        },
      ],
    },
    {
      id: 'stat.second-year',
      kind: 'group',
      label: 'Second year',
      year: 2,
      sourceUrl: SOURCE,
      items: [
        // Footnote 6 warns MATH 210 may not run every year and costs an extra
        // elective credit. CPSC 210 is the dependable route, and the solver
        // prefers whichever alternative is actually offered.
        one('stat.prog', 'CPSC 210 or MATH 210', ['CPSC 210', 'MATH 210']),
        course('stat.math200', 'MATH 200'),
        course('stat.math220', 'MATH 220'),
        course('stat.math221', 'MATH 221'),
        course('stat.stat200', 'STAT 200'),
        course('stat.stat201', 'STAT 201'),
        one('stat.302', 'STAT 302 or MATH 302', ['STAT 302', 'MATH 302']),
      ],
    },
    {
      id: 'stat.upper-years',
      kind: 'group',
      label: 'Third and fourth years',
      year: 3,
      sourceUrl: SOURCE,
      items: [
        course('stat.stat301', 'STAT 301'),
        course('stat.stat305', 'STAT 305'),
        course('stat.stat306', 'STAT 306'),
        course('stat.math307', 'MATH 307'),
        course('stat.stat404', 'STAT 404'),
        course('stat.math303', 'MATH 303'),
        {
          id: 'stat.stat300',
          kind: 'credits',
          label: '6 credits of STAT numbered 300 or above',
          n: 6,
          from: {
            kind: 'pattern',
            subjects: ['STAT'],
            levelMin: 300,
            levelMax: 499,
            // The named third and fourth year STAT courses cannot also count here.
            exclude: ['STAT 301', 'STAT 305', 'STAT 306', 'STAT 404'],
          },
          sourceUrl: SOURCE,
          confidence: 'stated',
        },
        {
          id: 'stat.stat400',
          kind: 'credits',
          label: '6 credits of STAT numbered 400 or above',
          n: 6,
          from: { kind: 'pattern', subjects: ['STAT'], levelMin: 400, levelMax: 499, exclude: ['STAT 404'] },
          sourceUrl: SOURCE,
          confidence: 'stated',
        },
        {
          id: 'stat.math300',
          kind: 'credits',
          label: '3 credits of MATH numbered 300 or above',
          n: 3,
          from: {
            kind: 'pattern',
            subjects: ['MATH'],
            levelMin: 300,
            levelMax: 499,
            exclude: ['MATH 303', 'MATH 307'],
          },
          sourceUrl: SOURCE,
          confidence: 'stated',
        },
        {
          id: 'stat.thematic',
          kind: 'credits',
          label: 'Thematic concentration, 300 or above',
          n: 9,
          from: { kind: 'codes', codes: THEMATIC },
          sourceUrl: SOURCE,
          confidence: 'stated',
        },
      ],
    },
    // 11, 8 and 18 across the three tables, kept per year: the Calendar has
    // already decided how many electives belong in each year, and following it
    // spreads them better than any heuristic the solver could invent.
    { id: 'stat.electives.y1', kind: 'credits', label: 'Electives', elective: true, n: 11, year: 1,
      from: { kind: 'codes', codes: [] }, sourceUrl: SOURCE, confidence: 'stated' },
    { id: 'stat.electives.y2', kind: 'credits', label: 'Electives', elective: true, n: 8, year: 2,
      from: { kind: 'codes', codes: [] }, sourceUrl: SOURCE, confidence: 'stated' },
    { id: 'stat.electives.y34', kind: 'credits', label: 'Electives', elective: true, n: 18, year: 3,
      from: { kind: 'codes', codes: [] }, sourceUrl: SOURCE, confidence: 'stated' },
  ],
};
