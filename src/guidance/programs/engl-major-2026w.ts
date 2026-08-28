import type { Program, Rule } from '@/guidance/rules';

const SOURCE =
  'https://vancouver.calendar.ubc.ca/faculties-colleges-and-schools/faculty-arts/bachelor-arts/english';

/**
 * The four Literature Course Groups, as the Calendar states them — by number
 * range rather than by list.
 *
 * Group D is the awkward one: it is two disjoint ranges, ENGL 332 to 339 and
 * ENGL 380 to 397, which a single course set cannot express. It is written as
 * a one-of over the two halves instead, which says the same thing — three
 * credits from either range.
 */
const GROUPS = {
  a: { label: 'Group A — Medieval and Renaissance', min: 343, max: 350 },
  b: { label: 'Group B — 18th- and 19th-Century', min: 351, max: 364 },
  c: { label: 'Group C — Modern, Contemporary, Transnational and Indigenous', min: 365, max: 379 },
};
const D_RANGES = [
  { min: 332, max: 339 },
  { min: 380, max: 397 },
];

const range = (id: string, label: string, n: number, min: number, max: number, year: number): Rule => ({
  id, kind: 'credits', label, n, year,
  from: { kind: 'pattern', subjects: ['ENGL'], levelMin: min, levelMax: max },
  sourceUrl: SOURCE, confidence: 'stated',
});

/** "3 credits from Group D", which is two ranges rather than one. */
const groupD = (id: string, year: number): Rule => ({
  id, kind: 'chooseN', label: 'Group D — Media, Theory, Genre and Special Topic', n: 1, year,
  sourceUrl: SOURCE, confidence: 'stated',
  of: D_RANGES.map((r, i) => ({
    id: `${id}.r${i}`,
    kind: 'credits' as const,
    label: `ENGL ${r.min}–${r.max}`,
    n: 3,
    from: { kind: 'pattern' as const, subjects: ['ENGL'], levelMin: r.min, levelMax: r.max },
    sourceUrl: SOURCE,
    confidence: 'stated' as const,
  })),
});

/**
 * Major in English: Literature Emphasis (B.A.), 2026W — 42 credits toward a
 * 120-credit degree.
 *
 * The Department offers this major in three emphases — Literature, Language,
 * and Language and Literature. Literature is the one transcribed here, being
 * the largest; the other two are recorded as a note rather than as separate
 * programs.
 *
 * Its course groups are stated as number ranges, not lists, which the rule
 * language handles directly. The exception is Group D, two disjoint ranges,
 * written as a one-of over the halves.
 */
export const englMajor2026W: Program = {
  code: 'engl-major-ba-2026w',
  name: 'English Major (Literature)',
  degree: 'BA',
  faculty: 'Arts',
  catalogYear: '2026W',
  extends: ['arts-faculty-core-2026w'],
  sourceUrl: SOURCE,
  totalCredits: 120,
  rules: [
    {
      id: 'engl.lower',
      kind: 'group',
      label: 'Lower-level requirements — 12 credits',
      sourceUrl: SOURCE,
      items: [
        {
          // The Calendar gives seven ways to make up these 6 credits, most of
          // them first-year programs that also satisfy the Writing Component.
          // The plain route is planned; the rest are in the note below.
          id: 'engl.100-level',
          kind: 'credits',
          label: 'ENGL at the 100 level',
          n: 6,
          year: 1,
          from: { kind: 'pattern', subjects: ['ENGL'], levelMin: 100, levelMax: 199 },
          sourceUrl: SOURCE,
          confidence: 'stated',
        },
        { id: 'engl.200', kind: 'course', label: 'ENGL 200', code: 'ENGL 200', year: 2,
          sourceUrl: SOURCE, confidence: 'stated' },
        {
          id: 'engl.220s',
          kind: 'credits',
          label: 'ENGL 220–249',
          n: 3,
          year: 2,
          from: { kind: 'pattern', subjects: ['ENGL'], levelMin: 220, levelMax: 249 },
          sourceUrl: SOURCE,
          confidence: 'stated',
        },
      ],
    },
    {
      id: 'engl.groups',
      kind: 'group',
      label: '12 credits — 3 from each of Groups A, B, C and D',
      year: 3,
      sourceUrl: SOURCE,
      items: [
        range('engl.groups.a', GROUPS.a.label, 3, GROUPS.a.min, GROUPS.a.max, 3),
        range('engl.groups.b', GROUPS.b.label, 3, GROUPS.b.min, GROUPS.b.max, 3),
        range('engl.groups.c', GROUPS.c.label, 3, GROUPS.c.min, GROUPS.c.max, 3),
        groupD('engl.groups.d', 3),
      ],
    },
    {
      id: 'engl.ab',
      kind: 'chooseN',
      label: '3 further credits from Group A or B',
      n: 1,
      year: 3,
      sourceUrl: SOURCE,
      confidence: 'stated',
      of: [
        range('engl.ab.a', GROUPS.a.label, 3, GROUPS.a.min, GROUPS.a.max, 3),
        range('engl.ab.b', GROUPS.b.label, 3, GROUPS.b.min, GROUPS.b.max, 3),
      ],
    },
    {
      id: 'engl.cd',
      kind: 'chooseN',
      label: '3 further credits from Group C or D',
      n: 1,
      year: 4,
      sourceUrl: SOURCE,
      confidence: 'stated',
      of: [
        range('engl.cd.c', GROUPS.c.label, 3, GROUPS.c.min, GROUPS.c.max, 3),
        ...D_RANGES.map((r, i) => range(`engl.cd.d${i}`, `Group D — ENGL ${r.min}–${r.max}`, 3, r.min, r.max, 4)),
      ],
    },
    {
      // ENGL 222 satisfies this but does NOT count toward the 30 upper-level
      // credits, so it is left out of the choice and put in a note — the same
      // treatment SOCI 370 gets for the same reason.
      id: 'engl.canadian',
      kind: 'chooseN',
      label: 'Canadian Literature — 3 credits',
      n: 1,
      year: 4,
      sourceUrl: SOURCE,
      confidence: 'stated',
      of: ['ENGL 360', 'ENGL 371', 'ENGL 372', 'ENGL 373', 'ENGL 394'].map((code) => ({
        id: `engl.canadian.${code.replace(' ', '')}`,
        kind: 'course' as const,
        label: code,
        code,
      })),
    },
    { id: 'engl.490', kind: 'course', label: 'ENGL 490', code: 'ENGL 490', year: 4,
      sourceUrl: SOURCE, confidence: 'stated' },
    {
      id: 'engl.upper-additional',
      kind: 'credits',
      label: 'Further upper-level ENGL',
      n: 6,
      year: 4,
      from: { kind: 'pattern', subjects: ['ENGL'], levelMin: 300, levelMax: 499, exclude: ['ENGL 490'] },
      sourceUrl: SOURCE,
      confidence: 'stated',
    },
    {
      id: 'engl.first-year-routes',
      kind: 'note',
      label: 'Seven ways to make up the first-year 6 credits',
      detail:
        'Six credits of 100-level English is one. The others are Arts One; CAP 100 and ' +
        '101; CAP 100 plus 3 credits of 100-level English; WRDS 150, 151 or 350 plus 3 ' +
        'credits of 100-level English; 6 credits of ASTU 100; or ASTU 100 or 101 plus 3 ' +
        'credits of 100-level English. Several of these also satisfy the Faculty Writing ' +
        'Component, so choosing one can save 3 credits elsewhere.',
      sourceUrl: SOURCE,
      confidence: 'stated',
    },
    {
      id: 'engl.222',
      kind: 'note',
      label: 'ENGL 222 counts for Canadian Literature but not toward the 30',
      detail:
        'It satisfies the Canadian Literature requirement, but does not count toward the ' +
        'required 30 upper-level ENGL credits, so taking it means finding those 3 credits ' +
        'elsewhere. Left out of the choice above for that reason. Any other course with a ' +
        'large selection of Canadian literature may be pre-approved by a Majors Advisor.',
      sourceUrl: SOURCE,
      confidence: 'stated',
    },
    {
      id: 'engl.emphases',
      kind: 'note',
      label: 'There are also Language and Language-and-Literature emphases',
      detail:
        'Both replace the literature groups with five Language Course Groups — Structure ' +
        'of English, History of English, Approaches to Contemporary English, Discourse ' +
        'and Meaning, and Rhetoric — and swap the ENGL 490 seminar for ENGL 489. Not ' +
        'transcribed as separate programs.',
      sourceUrl: SOURCE,
      confidence: 'stated',
    },
    {
      id: 'engl.research-component',
      kind: 'note',
      label: 'Research Component — met by ENGL 490',
      detail:
        'The Faculty of Arts Research Component names ENGL 490, 491, 492, 496 and 499 for ' +
        'the Literature emphasis, and ENGL 489 for the Language emphasis. ENGL 490 is ' +
        'already required above, so it costs no additional credits.',
      sourceUrl: SOURCE,
      confidence: 'stated',
    },
    // 42 credits of major and 3 of the Faculty's Writing Component leave 75.
    { id: 'engl.electives.y1', kind: 'credits', label: 'Electives', elective: true, n: 21, year: 1,
      from: { kind: 'codes', codes: [] }, sourceUrl: SOURCE, confidence: 'stated' },
    { id: 'engl.electives.y2', kind: 'credits', label: 'Electives', elective: true, n: 24, year: 2,
      from: { kind: 'codes', codes: [] }, sourceUrl: SOURCE, confidence: 'stated' },
    { id: 'engl.electives.y3', kind: 'credits', label: 'Electives', elective: true, n: 15, year: 3,
      from: { kind: 'codes', codes: [] }, sourceUrl: SOURCE, confidence: 'stated' },
    { id: 'engl.electives.y4', kind: 'credits', label: 'Electives', elective: true, n: 15, year: 4,
      from: { kind: 'codes', codes: [] }, sourceUrl: SOURCE, confidence: 'stated' },
  ],
};
