import type { Program, Rule } from '@/guidance/rules';

const SOURCE =
  'https://vancouver.calendar.ubc.ca/faculties-colleges-and-schools/faculty-science/bachelor-science/biology';
const COMM =
  'https://vancouver.calendar.ubc.ca/faculties-colleges-and-schools/faculty-science/bachelor-science/communication-requirements';

/** "Students must take at least two of the following courses." */
const LAB_SELECTIONS = [
  'BIOL 306', 'BIOL 311', 'BIOL 326', 'BIOL 331', 'BIOL 337', 'BIOL 340', 'BIOL 341',
  'BIOL 351', 'BIOL 352', 'BIOL 363', 'BIOL 402', 'BIOL 403', 'BIOL 404', 'BIOL 409',
  'BIOL 437',
];

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
 * Biology Major (BSc), 2026W — 120 credits.
 *
 * Denser than the other Science majors: first year runs to 31 credits rather
 * than 30, second year carries a two-of-seven organismal diversity choice,
 * and the upper years are built from two named selection lists rather than
 * named courses.
 *
 * Several footnotes permit deferring a first- or second-year course to a
 * later year to make room for electives. Those are recorded as a note rather
 * than modelled: the plan shows the Calendar's own placement, and moving a
 * course later is exactly what a student does with the credit-load control.
 */
export const biolMajor2026W: Program = {
  code: 'biol-major-bsc-2026w',
  name: 'Biology Major',
  degree: 'BSc',
  faculty: 'Science',
  catalogYear: '2026W',
  extends: ['science-faculty-core-2026w'],
  sourceUrl: SOURCE,
  totalCredits: 120,
  rules: [
    {
      id: 'biol.first-year',
      kind: 'group',
      label: 'First year',
      year: 1,
      sourceUrl: SOURCE,
      items: [
        course('biol.scie113', 'SCIE 113'),
        course('biol.112', 'BIOL 112'),
        course('biol.121', 'BIOL 121'),
        one('biol.180', 'BIOL 180 or BIOL 140', ['BIOL 180', 'BIOL 140']),
        one('biol.chem1', 'CHEM 121, 111 or 141', ['CHEM 121', 'CHEM 111', 'CHEM 141']),
        course('biol.chem123', 'CHEM 123'),
        one('biol.computing', 'CPSC 103 or DSCI 100', ['CPSC 103', 'DSCI 100']),
        one('biol.calc1', 'Differential calculus', [
          'MATH 100', 'MATH 102', 'MATH 104', 'MATH 120', 'MATH 180', 'MATH 184',
        ]),
        one('biol.calc2', 'Integral calculus', ['MATH 101', 'MATH 103', 'MATH 105', 'MATH 121']),
        course('biol.phys131', 'PHYS 131'),
      ],
    },
    {
      id: 'biol.second-year',
      kind: 'group',
      label: 'Second year',
      year: 2,
      sourceUrl: SOURCE,
      items: [
        {
          id: 'biol.comm-additional',
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
        course('biol.200', 'BIOL 200'),
        course('biol.230', 'BIOL 230'),
        course('biol.260', 'BIOL 260'),
        one('biol.genetics', 'BIOL 233 or 234', ['BIOL 233', 'BIOL 234']),
        {
          // "Two of BIOL 203, 204, 205, 209, 210, or MICB 201 or 211" — the
          // first requirement in any program here that chooses more than one.
          id: 'biol.diversity',
          kind: 'chooseN',
          label: 'Two organismal diversity courses',
          n: 2,
          sourceUrl: SOURCE,
          confidence: 'stated',
          of: ['BIOL 203', 'BIOL 204', 'BIOL 205', 'BIOL 209', 'BIOL 210', 'MICB 201', 'MICB 211'].map(
            (code) => ({
              id: `biol.diversity.${code.replace(' ', '')}`,
              kind: 'course' as const,
              label: code,
              code,
            }),
          ),
        },
        course('biol.chem233', 'CHEM 233'),
        course('biol.chem235', 'CHEM 235'),
      ],
    },
    {
      id: 'biol.upper-years',
      kind: 'group',
      label: 'Third and fourth years',
      year: 3,
      sourceUrl: SOURCE,
      items: [
        // Footnote 11 allows STAT 200 in place of BIOL 300 with a Biology
        // advisor's permission; permission is not something the plan can
        // assume, so only the default route is modelled.
        course('biol.300', 'BIOL 300'),
        course('biol.336', 'BIOL 336'),
        {
          id: 'biol.lab-selections',
          kind: 'credits',
          label: 'Biology Laboratory Selections',
          n: 4,
          from: { kind: 'codes', codes: LAB_SELECTIONS },
          sourceUrl: SOURCE,
          confidence: 'stated',
        },
        {
          id: 'biol.life-science',
          kind: 'credits',
          label: 'Life Science Selections',
          n: 20,
          // The Calendar prints an explicit list, split into courses that do
          // and do not count toward the Science Requirement. It is not
          // transcribed here, so this is a pattern over the life-science
          // subjects at the upper level — wide enough to suggest sensible
          // courses, and marked inferred because a course outside these
          // subjects may well be on the real list.
          from: {
            kind: 'pattern',
            subjects: ['BIOL', 'MICB', 'BIOC', 'CAPS', 'ZOOL', 'BOTA', 'MRNE', 'PCTH'],
            levelMin: 300,
            levelMax: 499,
            exclude: ['BIOL 300', 'BIOL 336'],
          },
          sourceUrl: SOURCE,
          confidence: 'inferred',
        },
        {
          id: 'biol.selection-note',
          kind: 'note',
          label: 'Laboratory and Life Science selection lists',
          detail:
            'The Calendar prints both lists in full, and notes that BIOL 351 and 352 may ' +
            'be split between the two. Confirm your choices against that page — the Life ' +
            'Science list here is approximated by subject and level.',
          sourceUrl: SOURCE,
          confidence: 'stated',
        },
        {
          id: 'biol.defer-note',
          kind: 'note',
          label: 'Several courses may be deferred to a later year',
          detail:
            'Footnotes 3, 5, 7 and 8 allow the computing course, PHYS 131, up to 3 credits ' +
            'of the second-year BIOL core and up to 4 credits of the diversity requirement ' +
            'to move to a later year to make room for electives. The plan shows the ' +
            "Calendar's own placement.",
          sourceUrl: SOURCE,
          confidence: 'stated',
        },
      ],
    },
    // 3 in second year and 29 across the upper years.
    { id: 'biol.electives.y2', kind: 'credits', label: 'Electives', elective: true, n: 3, year: 2,
      from: { kind: 'codes', codes: [] }, sourceUrl: SOURCE, confidence: 'stated' },
    { id: 'biol.electives.y34', kind: 'credits', label: 'Electives', elective: true, n: 29, year: 3,
      from: { kind: 'codes', codes: [] }, sourceUrl: SOURCE, confidence: 'stated' },
  ],
};
