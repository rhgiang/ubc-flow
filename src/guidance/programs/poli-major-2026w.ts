import type { Program, Rule } from '@/guidance/rules';

const SOURCE =
  'https://vancouver.calendar.ubc.ca/faculties-colleges-and-schools/faculty-arts/bachelor-arts/political-science';

const course = (id: string, code: string, year: number): Rule => ({
  id, kind: 'course', label: code, code, year, sourceUrl: SOURCE, confidence: 'stated',
});

/**
 * Major in Political Science (B.A.), 2026W — 42 credits toward a 120-credit
 * degree, 30 of them at the 300 level or above.
 *
 * The Calendar offers this major with or without an Area of Focus in
 * Politics, Policy and Administration. The plain major is transcribed here;
 * the PPA variant replaces POLI 240 with 220 and names nine further credits,
 * and is recorded as a note rather than a second program.
 */
export const poliMajor2026W: Program = {
  code: 'poli-major-ba-2026w',
  name: 'Political Science Major',
  degree: 'BA',
  faculty: 'Arts',
  catalogYear: '2026W',
  extends: ['arts-faculty-core-2026w'],
  sourceUrl: SOURCE,
  totalCredits: 120,
  rules: [
    {
      id: 'poli.lower',
      kind: 'group',
      label: 'Lower-level requirements — 12 credits at the 100 and 200 level',
      sourceUrl: SOURCE,
      items: [
        course('poli.100', 'POLI 100', 1),
        course('poli.101', 'POLI 101', 1),
        course('poli.110', 'POLI 110', 2),
        {
          // "Students who have not completed POLI_V 240 may substitute
          // POLI_V 340 ... although they are still required to complete a
          // total of 12 POLI_V credits at the 100- and 200-level." The
          // substitution is offered here; the note below carries the catch.
          id: 'poli.240',
          kind: 'chooseN',
          label: 'POLI 240 or 340',
          n: 1,
          year: 2,
          sourceUrl: SOURCE,
          confidence: 'stated',
          of: [
            { id: 'poli.240.240', kind: 'course', label: 'POLI 240', code: 'POLI 240' },
            { id: 'poli.240.340', kind: 'course', label: 'POLI 340', code: 'POLI 340' },
          ],
        },
      ],
    },
    {
      id: 'poli.upper',
      kind: 'group',
      label: 'Upper-level requirements — 30 credits at 300 or above',
      year: 3,
      sourceUrl: SOURCE,
      items: [
        course('poli.380', 'POLI 380', 3),
        {
          // "To satisfy the Bachelor of Arts Writing and Research
          // Requirement, students must take at least one 400-level POLI_V
          // course." This is the Research Component, met inside the major.
          id: 'poli.400-level',
          kind: 'credits',
          label: 'At least one POLI course at the 400 level',
          n: 3,
          year: 4,
          from: { kind: 'pattern', subjects: ['POLI'], levelMin: 400, levelMax: 499 },
          sourceUrl: SOURCE,
          confidence: 'stated',
        },
        {
          id: 'poli.upper-additional.y3',
          kind: 'credits',
          label: 'Further POLI at 300 or above',
          n: 12,
          year: 3,
          from: {
            kind: 'pattern', subjects: ['POLI'], levelMin: 300, levelMax: 499,
            exclude: ['POLI 380', 'POLI 340'],
          },
          sourceUrl: SOURCE,
          confidence: 'stated',
        },
        {
          id: 'poli.upper-additional.y4',
          kind: 'credits',
          label: 'Further POLI at 300 or above',
          n: 12,
          year: 4,
          from: {
            kind: 'pattern', subjects: ['POLI'], levelMin: 300, levelMax: 499,
            exclude: ['POLI 380', 'POLI 340'],
          },
          sourceUrl: SOURCE,
          confidence: 'stated',
        },
      ],
    },
    {
      id: 'poli.research-component',
      kind: 'note',
      label: 'Research Component — met by any 400-level POLI course',
      detail:
        'The Faculty of Arts Research Component accepts all POLI courses at the 400 level ' +
        'for this major, and the rule above already requires one, so it costs no ' +
        'additional credits.',
      sourceUrl: SOURCE,
      confidence: 'stated',
    },
    {
      id: 'poli.240-substitution',
      kind: 'note',
      label: 'Substituting POLI 340 does not reduce the lower-level 12',
      detail:
        'A student who takes POLI 340 in place of POLI 240 still owes 12 POLI credits at ' +
        'the 100 and 200 level, so another lower-level course is needed to make it up.',
      sourceUrl: SOURCE,
      confidence: 'stated',
    },
    {
      id: 'poli.380-exclusion',
      kind: 'note',
      label: 'POLI 380 overlaps the Science Credit Exclusion Lists',
      detail:
        'Credit is not granted for both POLI 380 and any of the courses on the Science ' +
        'Credit Exclusion Lists when counting toward the 120 credits needed to graduate.',
      sourceUrl: SOURCE,
      confidence: 'stated',
    },
    {
      id: 'poli.ppa',
      kind: 'note',
      label: 'There is also an Area of Focus in Politics, Policy and Administration',
      detail:
        'That variant takes POLI 220 instead of 240, and its 30 upper-level credits are ' +
        'partly named: 3 credits of ECON 310 or 311, then POLI 380, 302 and 350, then 6 ' +
        'credits from the PPA-designated list, then 12 further POLI credits at 300 or ' +
        'above. Not transcribed as a separate program.',
      sourceUrl: SOURCE,
      confidence: 'stated',
    },
    // 42 credits of major and 3 of the Faculty's Writing Component leave 75.
    { id: 'poli.electives.y1', kind: 'credits', label: 'Electives', elective: true, n: 21, year: 1,
      from: { kind: 'codes', codes: [] }, sourceUrl: SOURCE, confidence: 'stated' },
    { id: 'poli.electives.y2', kind: 'credits', label: 'Electives', elective: true, n: 24, year: 2,
      from: { kind: 'codes', codes: [] }, sourceUrl: SOURCE, confidence: 'stated' },
    { id: 'poli.electives.y3', kind: 'credits', label: 'Electives', elective: true, n: 15, year: 3,
      from: { kind: 'codes', codes: [] }, sourceUrl: SOURCE, confidence: 'stated' },
    { id: 'poli.electives.y4', kind: 'credits', label: 'Electives', elective: true, n: 15, year: 4,
      from: { kind: 'codes', codes: [] }, sourceUrl: SOURCE, confidence: 'stated' },
  ],
};
