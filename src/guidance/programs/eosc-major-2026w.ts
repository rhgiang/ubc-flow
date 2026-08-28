import type { Program, Rule } from '@/guidance/rules';

const SOURCE =
  'https://vancouver.calendar.ubc.ca/faculties-colleges-and-schools/faculty-science/bachelor-science/earth-and-ocean-sciences';
const COMM =
  'https://vancouver.calendar.ubc.ca/faculties-colleges-and-schools/faculty-science/bachelor-science/communication-requirements';

/** The three subjects this program draws its own courses from. */
const EOSC_SUBJECTS = ['EOSC', 'ENVR', 'ATSC'];

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
 * Earth and Ocean Sciences Major (BSc), 2026W — 120 credits.
 *
 * The most open-ended Science program here: beyond first and second year it
 * names almost nothing, asking instead for 24 credits of EOSC, ENVR or ATSC
 * at the 300 level and 6 more at the 400 level. That makes for a plan that
 * is mostly slots in the upper years, which is what the Calendar itself
 * prescribes rather than a gap in the transcription.
 *
 * Its degree row reads "Minimum Credits for Degree", not "Total" — the only
 * program here worded that way.
 */
export const eoscMajor2026W: Program = {
  code: 'eosc-major-bsc-2026w',
  name: 'Earth and Ocean Sciences Major',
  degree: 'BSc',
  faculty: 'Science',
  catalogYear: '2026W',
  extends: ['science-faculty-core-2026w'],
  sourceUrl: SOURCE,
  totalCredits: 120,
  rules: [
    {
      id: 'eosc.first-year',
      kind: 'group',
      label: 'First year',
      year: 1,
      sourceUrl: SOURCE,
      items: [
        course('eosc.scie113', 'SCIE 113'),
        one('eosc.chem1', 'CHEM 121, 111 or 141', ['CHEM 121', 'CHEM 111', 'CHEM 141']),
        course('eosc.chem123', 'CHEM 123'),
        {
          id: 'eosc.intro',
          kind: 'credits',
          label: 'EOSC or ATSC at the 100 level',
          n: 6,
          from: { kind: 'pattern', subjects: ['EOSC', 'ATSC'], levelMin: 100, levelMax: 199 },
          sourceUrl: SOURCE,
          confidence: 'stated',
        },
        course('eosc.111', 'EOSC 111'),
        one('eosc.calc1', 'Differential calculus', ['MATH 100', 'MATH 102', 'MATH 104']),
        one('eosc.calc2', 'Integral calculus', ['MATH 101', 'MATH 103', 'MATH 105']),
        {
          // Footnote 5 excludes PHYS 100 from this row.
          id: 'eosc.phys100',
          kind: 'credits',
          label: 'PHYS at the 100 level',
          n: 3,
          from: {
            kind: 'pattern',
            subjects: ['PHYS'],
            levelMin: 100,
            levelMax: 199,
            exclude: ['PHYS 100'],
          },
          sourceUrl: SOURCE,
          confidence: 'stated',
        },
      ],
    },
    {
      id: 'eosc.second-year',
      kind: 'group',
      label: 'Second year',
      year: 2,
      sourceUrl: SOURCE,
      items: [
        {
          id: 'eosc.comm-additional',
          kind: 'credits',
          label: 'Communication requirement (approved list)',
          n: 3,
          from: { kind: 'codes', codes: [] },
          sourceUrl: COMM,
          confidence: 'inferred',
        },
        one('eosc.211', 'EOSC 211 or GEOS/GEOB 270', ['EOSC 211', 'GEOS 270', 'GEOB 270']),
        course('eosc.212', 'EOSC 212'),
        {
          id: 'eosc.200-level',
          kind: 'credits',
          label: 'EOSC, ENVR or ATSC at 200 or above',
          n: 6,
          from: {
            kind: 'pattern',
            subjects: EOSC_SUBJECTS,
            levelMin: 200,
            levelMax: 499,
            exclude: ['EOSC 211', 'EOSC 212'],
          },
          sourceUrl: SOURCE,
          confidence: 'stated',
        },
      ],
    },
    {
      id: 'eosc.upper-years',
      kind: 'group',
      label: 'Third and fourth years',
      year: 3,
      sourceUrl: SOURCE,
      items: [
        {
          id: 'eosc.300-level',
          kind: 'credits',
          label: 'EOSC, ENVR or ATSC at 300 or above',
          n: 24,
          from: { kind: 'pattern', subjects: EOSC_SUBJECTS, levelMin: 300, levelMax: 499 },
          sourceUrl: SOURCE,
          confidence: 'stated',
        },
        {
          id: 'eosc.400-level',
          kind: 'credits',
          label: 'EOSC, ENVR or ATSC at the 400 level',
          n: 6,
          from: { kind: 'pattern', subjects: EOSC_SUBJECTS, levelMin: 400, levelMax: 499 },
          sourceUrl: SOURCE,
          confidence: 'stated',
        },
        {
          id: 'eosc.substitution-note',
          kind: 'note',
          label: 'Up to 6 upper-level credits may come from outside the three subjects',
          detail:
            'Footnote 9 allows a maximum of 6 credits of the 300-level requirement to be ' +
            'replaced from a named list including BIOL 306 and CHEM 301, 302. Not modelled ' +
            '— the plan takes the default route through EOSC, ENVR and ATSC.',
          sourceUrl: SOURCE,
          confidence: 'stated',
        },
      ],
    },
    // 3 + 15 + 30 across the three tables.
    { id: 'eosc.electives.y1', kind: 'credits', label: 'Electives', elective: true, n: 3, year: 1,
      from: { kind: 'codes', codes: [] }, sourceUrl: SOURCE, confidence: 'stated' },
    { id: 'eosc.electives.y2', kind: 'credits', label: 'Electives', elective: true, n: 15, year: 2,
      from: { kind: 'codes', codes: [] }, sourceUrl: SOURCE, confidence: 'stated' },
    { id: 'eosc.electives.y34', kind: 'credits', label: 'Electives', elective: true, n: 30, year: 3,
      from: { kind: 'codes', codes: [] }, sourceUrl: SOURCE, confidence: 'stated' },
  ],
};
