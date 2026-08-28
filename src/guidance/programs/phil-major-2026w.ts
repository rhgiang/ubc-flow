import type { Program, Rule } from '@/guidance/rules';

const SOURCE =
  'https://vancouver.calendar.ubc.ca/faculties-colleges-and-schools/faculty-arts/bachelor-arts/philosophy';

/** Credit for PHIL 400 and 401 counts toward no specialization in Philosophy. */
const NOT_COUNTED = ['PHIL 400', 'PHIL 401'];

const HISTORY = [
  'PHIL 310', 'PHIL 311', 'PHIL 313', 'PHIL 314', 'PHIL 315', 'PHIL 316',
  'PHIL 371', 'PHIL 378', 'PHIL 388', 'ASIA 372',
];
const RESEARCH_SEMINARS = [
  'PHIL 418', 'PHIL 426', 'PHIL 431', 'PHIL 432', 'PHIL 440',
  'PHIL 450', 'PHIL 452', 'PHIL 455', 'PHIL 469', 'PHIL 491',
];

const one = (id: string, label: string, codes: string[], year: number): Rule => ({
  id, kind: 'chooseN', label, n: 1, year, sourceUrl: SOURCE, confidence: 'stated',
  of: codes.map((code) => ({
    id: `${id}.${code.replace(' ', '')}`, kind: 'course' as const, label: code, code,
  })),
});

/**
 * Major in Philosophy (B.A.), 2026W — 42 credits toward a 120-credit degree.
 *
 * The Calendar states this one as two totals rather than a course list: at
 * least 42 approved Philosophy credits, of which at least 30 upper-level. The
 * named requirements fill only part of that, and the rest is "additional
 * Philosophy" at a stated level, which is why so much of this program is
 * credit buckets rather than courses.
 *
 * Two of the area requirements can be met at either level — Value Theory with
 * PHIL 230 or 330, Epistemology/Metaphysics with 240 or 340 — so how many
 * further upper-level credits a student needs depends on which they take. The
 * split below assumes the lower-level option in both, the common path and the
 * one that needs the most upper-level credits after it.
 */
export const philMajor2026W: Program = {
  code: 'phil-major-ba-2026w',
  name: 'Philosophy Major',
  degree: 'BA',
  faculty: 'Arts',
  catalogYear: '2026W',
  extends: ['arts-faculty-core-2026w'],
  sourceUrl: SOURCE,
  totalCredits: 120,
  rules: [
    {
      id: 'phil.areas',
      kind: 'group',
      label: 'Area requirements',
      sourceUrl: SOURCE,
      items: [
        one('phil.logic', 'Symbolic Logic: PHIL 220 or 222', ['PHIL 220', 'PHIL 222'], 2),
        one('phil.value', 'Value Theory: PHIL 230 or 330', ['PHIL 230', 'PHIL 330'], 2),
        one('phil.epis', 'Epistemology/Metaphysics: PHIL 240 or 340', ['PHIL 240', 'PHIL 340'], 2),
        {
          id: 'phil.history',
          kind: 'credits',
          label: 'History of Philosophy — 6 credits',
          n: 6,
          year: 3,
          from: { kind: 'codes', codes: HISTORY },
          sourceUrl: SOURCE,
          confidence: 'stated',
        },
      ],
    },
    {
      id: 'phil.research',
      kind: 'chooseN',
      label: 'Research Seminar',
      n: 1,
      year: 4,
      sourceUrl: SOURCE,
      confidence: 'stated',
      of: RESEARCH_SEMINARS.map((code) => ({
        id: `phil.research.${code.replace(' ', '')}`,
        kind: 'course' as const,
        label: code,
        code,
      })),
    },
    {
      // "a total of 30 upper-level credits in Philosophy including any
      // upper-level courses taken to meet the Area Requirements or the
      // Research Requirement." History (6) and the seminar (3) are already
      // upper-level, leaving 21 when both flexible areas are taken low.
      id: 'phil.upper-additional.y3',
      kind: 'credits',
      label: 'Further PHIL at the 300 or 400 level',
      n: 12,
      year: 3,
      from: {
        kind: 'pattern', subjects: ['PHIL'], levelMin: 300, levelMax: 499,
        exclude: [...NOT_COUNTED, 'PHIL 330', 'PHIL 340', ...HISTORY, ...RESEARCH_SEMINARS],
      },
      sourceUrl: SOURCE,
      confidence: 'stated',
    },
    {
      id: 'phil.upper-additional.y4',
      kind: 'credits',
      label: 'Further PHIL at the 300 or 400 level',
      n: 9,
      year: 4,
      from: {
        kind: 'pattern', subjects: ['PHIL'], levelMin: 300, levelMax: 499,
        exclude: [...NOT_COUNTED, 'PHIL 330', 'PHIL 340', ...HISTORY, ...RESEARCH_SEMINARS],
      },
      sourceUrl: SOURCE,
      confidence: 'stated',
    },
    {
      // "students must complete additional courses in Philosophy at any level
      // in order to meet the total number of credits (42) required for the
      // Major. These credits may include preparatory courses."
      id: 'phil.any-level',
      kind: 'credits',
      label: 'Further PHIL at any level',
      n: 3,
      year: 1,
      from: { kind: 'pattern', subjects: ['PHIL'], levelMax: 499, exclude: NOT_COUNTED },
      sourceUrl: SOURCE,
      confidence: 'stated',
    },
    {
      id: 'phil.preparatory',
      kind: 'note',
      label: 'Introductory courses are recommended, not required',
      detail:
        'The Department recommends one or more of PHIL 100, 101, 102, 120, 125, 211, 212, ' +
        '235, 250, 260 or Arts One before further study. Any of them counts toward the ' +
        '"further PHIL at any level" credits above rather than adding to the 42.',
      sourceUrl: SOURCE,
      confidence: 'stated',
    },
    {
      id: 'phil.research-component',
      kind: 'note',
      label: 'Research Component — met by the Research Seminar',
      detail:
        'The Faculty of Arts Research Component names PHIL 418, 426, 431, 432, 440, 450, ' +
        '452, 455, 469, 490 and 491 for this major, and the Department’s own Research ' +
        'Seminar requirement above draws from that list, so it costs no additional ' +
        'credits. PHIL 400 and 401 count toward no Philosophy specialization at all, and ' +
        'ASIA 372 may be used for either the upper-level or the any-level requirement.',
      sourceUrl: SOURCE,
      confidence: 'stated',
    },
    // 42 credits of major and 3 of the Faculty's Writing Component leave 75.
    { id: 'phil.electives.y1', kind: 'credits', label: 'Electives', elective: true, n: 24, year: 1,
      from: { kind: 'codes', codes: [] }, sourceUrl: SOURCE, confidence: 'stated' },
    { id: 'phil.electives.y2', kind: 'credits', label: 'Electives', elective: true, n: 21, year: 2,
      from: { kind: 'codes', codes: [] }, sourceUrl: SOURCE, confidence: 'stated' },
    { id: 'phil.electives.y3', kind: 'credits', label: 'Electives', elective: true, n: 12, year: 3,
      from: { kind: 'codes', codes: [] }, sourceUrl: SOURCE, confidence: 'stated' },
    { id: 'phil.electives.y4', kind: 'credits', label: 'Electives', elective: true, n: 18, year: 4,
      from: { kind: 'codes', codes: [] }, sourceUrl: SOURCE, confidence: 'stated' },
  ],
};
