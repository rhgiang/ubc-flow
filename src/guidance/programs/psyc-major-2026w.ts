import type { Program, Rule } from '@/guidance/rules';

const SOURCE =
  'https://vancouver.calendar.ubc.ca/faculties-colleges-and-schools/faculty-arts/bachelor-arts/psychology';

/** PSYC 340, 388, 440 and 488 may not count toward the 30 upper-level credits. */
const NOT_COUNTED = ['PSYC 340', 'PSYC 388', 'PSYC 440', 'PSYC 488'];

const BEHAVIOURAL_NEUROSCIENCE = [
  'PSYC 301', 'PSYC 304', 'PSYC 306', 'PSYC 324', 'PSYC 344', 'PSYC 361',
  'PSYC 363', 'PSYC 460', 'PSYC 461', 'PSYC 462', 'PSYC 466', 'PSYC 472',
];
const COGNITIVE_SCIENCE = [
  'PSYC 309', 'PSYC 321', 'PSYC 333', 'PSYC 335', 'PSYC 336', 'PSYC 365',
  'PSYC 367', 'PSYC 368', 'PSYC 409', 'PSYC 421', 'PSYC 463',
];
/** The four lists the student must draw 6 credits from any two of. */
const CONTENT_AREAS: [string, string, string[]][] = [
  ['clinical', 'Clinical/Health', ['PSYC 300', 'PSYC 311', 'PSYC 314', 'PSYC 331', 'PSYC 350', 'PSYC 400', 'PSYC 401', 'PSYC 402', 'PSYC 469']],
  ['developmental', 'Developmental', ['PSYC 302', 'PSYC 315', 'PSYC 319', 'PSYC 320', 'PSYC 322', 'PSYC 325', 'PSYC 412', 'PSYC 413', 'PSYC 414']],
  ['foundations', 'Foundations/Psychometrics', ['PSYC 303', 'PSYC 312', 'PSYC 359']],
  ['personality', 'Personality/Social', ['PSYC 305', 'PSYC 307', 'PSYC 308', 'PSYC 358', 'PSYC 403', 'PSYC 404', 'PSYC 407', 'PSYC 408', 'PSYC 415', 'PSYC 418']],
];

const course = (id: string, code: string): Rule => ({
  id, kind: 'course', label: code, code, sourceUrl: SOURCE, confidence: 'stated',
});

/**
 * Major in Psychology (B.A.), 2026W — 42 credits toward a 120-credit degree.
 *
 * 6 credits of introductory psychology, 6 of quantitative methods, and 30 at
 * the 300 and 400 level, which is what the Faculty's summary table wants from
 * a Major. The Department adds its own floor on top of the Faculty's: at
 * least 30 upper-level PSYC credits specifically, which these rules meet
 * exactly.
 */
export const psycMajor2026W: Program = {
  code: 'psyc-major-ba-2026w',
  name: 'Psychology Major',
  degree: 'BA',
  faculty: 'Arts',
  catalogYear: '2026W',
  extends: ['arts-faculty-core-2026w'],
  sourceUrl: SOURCE,
  totalCredits: 120,
  rules: [
    {
      id: 'psyc.lower',
      kind: 'group',
      label: 'Lower-level requirements',
      sourceUrl: SOURCE,
      items: [
        {
          // "either PSYC_V 100; or PSYC_V 101 and PSYC_V 102" — a choice
          // between one 6-credit course and a pair of 3-credit ones, so the
          // second branch is a group and the plan takes both halves or
          // neither.
          id: 'psyc.intro',
          kind: 'chooseN',
          label: 'PSYC 100, or PSYC 101 and 102',
          n: 1,
          year: 1,
          sourceUrl: SOURCE,
          confidence: 'stated',
          of: [
            { id: 'psyc.intro.100', kind: 'course', label: 'PSYC 100', code: 'PSYC 100' },
            {
              id: 'psyc.intro.pair',
              kind: 'group',
              label: 'PSYC 101 and 102',
              items: [
                { id: 'psyc.intro.101', kind: 'course', label: 'PSYC 101', code: 'PSYC 101' },
                { id: 'psyc.intro.102', kind: 'course', label: 'PSYC 102', code: 'PSYC 102' },
              ],
            },
          ],
        },
        // Quantitative Methods. Both are restricted to declared Psychology
        // majors, which is why the Department asks students to declare on
        // reaching second-year standing.
        { ...course('psyc.217', 'PSYC 217'), year: 2 },
        { ...course('psyc.218', 'PSYC 218'), year: 2 },
      ],
    },
    {
      id: 'psyc.neuro-cog',
      kind: 'credits',
      label: '6 credits from Behavioural Neuroscience or Cognitive Science',
      n: 6,
      year: 3,
      // "At least 6 credits from the following two lists" — the two lists are
      // read together, not 6 credits from each.
      from: { kind: 'codes', codes: [...BEHAVIOURAL_NEUROSCIENCE, ...COGNITIVE_SCIENCE] },
      sourceUrl: SOURCE,
      confidence: 'stated',
    },
    {
      id: 'psyc.areas',
      kind: 'chooseN',
      label: '6 credits from each of two content areas',
      n: 2,
      year: 3,
      sourceUrl: SOURCE,
      confidence: 'stated',
      of: CONTENT_AREAS.map(([id, label, codes]) => ({
        id: `psyc.areas.${id}`,
        kind: 'credits' as const,
        label,
        n: 6,
        from: { kind: 'codes' as const, codes },
        sourceUrl: SOURCE,
        confidence: 'stated' as const,
      })),
    },
    {
      id: 'psyc.upper-additional',
      kind: 'credits',
      label: 'Further PSYC at the 300 or 400 level',
      n: 12,
      year: 4,
      from: {
        kind: 'pattern',
        subjects: ['PSYC'],
        levelMin: 300,
        levelMax: 499,
        exclude: NOT_COUNTED,
      },
      sourceUrl: SOURCE,
      confidence: 'stated',
    },
    {
      id: 'psyc.research-component',
      kind: 'note',
      label: 'Research Component: met by PSYC 217',
      detail:
        'The Faculty of Arts Research Component names PSYC 217 for this major, and it is ' +
        'already required above, so it costs no additional credits. Students considering ' +
        'graduate study are encouraged to take PSYC 359 as part of the upper-level ' +
        'requirement.',
      sourceUrl: SOURCE,
      confidence: 'stated',
    },
    {
      id: 'psyc.excluded',
      kind: 'note',
      label: 'PSYC 340, 388, 440 and 488 do not count toward the 30',
      detail:
        'They may still be taken as electives, but not toward the minimum 30 upper-level ' +
        'Psychology credits the Department requires for the Major.',
      sourceUrl: SOURCE,
      confidence: 'stated',
    },
    // 42 credits of major and 3 of the Faculty's Writing Component leave 75.
    { id: 'psyc.electives.y1', kind: 'credits', label: 'Electives', elective: true, n: 21, year: 1,
      from: { kind: 'codes', codes: [] }, sourceUrl: SOURCE, confidence: 'stated' },
    { id: 'psyc.electives.y2', kind: 'credits', label: 'Electives', elective: true, n: 24, year: 2,
      from: { kind: 'codes', codes: [] }, sourceUrl: SOURCE, confidence: 'stated' },
    { id: 'psyc.electives.y3', kind: 'credits', label: 'Electives', elective: true, n: 12, year: 3,
      from: { kind: 'codes', codes: [] }, sourceUrl: SOURCE, confidence: 'stated' },
    { id: 'psyc.electives.y4', kind: 'credits', label: 'Electives', elective: true, n: 18, year: 4,
      from: { kind: 'codes', codes: [] }, sourceUrl: SOURCE, confidence: 'stated' },
  ],
};
