import type { Program, Rule } from '@/guidance/rules';

const SOURCE =
  'https://vancouver.calendar.ubc.ca/faculties-colleges-and-schools/faculty-science/bachelor-science/microbiology-and-immunology';
const COMM =
  'https://vancouver.calendar.ubc.ca/faculties-colleges-and-schools/faculty-science/bachelor-science/communication-requirements';

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
 * Microbiology and Immunology Major (BSc), 2026W — 120 credits.
 *
 * The Calendar splits the upper years differently from every other program
 * here: alongside "Third Year" and "Fourth Year" it has a "Third or Fourth
 * Year" block whose courses may go in either. Those are recorded as year 3,
 * which is the earliest the Calendar permits — the plan may still push them
 * later when a prerequisite is missing, which is exactly what "or fourth"
 * means in practice.
 */
export const micbMajor2026W: Program = {
  code: 'micb-major-bsc-2026w',
  name: 'Microbiology and Immunology Major',
  degree: 'BSc',
  faculty: 'Science',
  catalogYear: '2026W',
  extends: ['science-faculty-core-2026w'],
  sourceUrl: SOURCE,
  totalCredits: 120,
  rules: [
    {
      id: 'micb.first-year',
      kind: 'group',
      label: 'First year',
      year: 1,
      sourceUrl: SOURCE,
      items: [
        course('micb.biol112', 'BIOL 112'),
        one('micb.biol1xx', 'BIOL 111 or 121', ['BIOL 111', 'BIOL 121']),
        one('micb.chem1', 'CHEM 121, 111 or 141', ['CHEM 121', 'CHEM 111', 'CHEM 141']),
        course('micb.chem123', 'CHEM 123'),
        one('micb.calc1', 'Differential calculus', ['MATH 100', 'MATH 102', 'MATH 104']),
        {
          id: 'micb.phys100',
          kind: 'credits',
          label: 'PHYS at the 100 level',
          n: 3,
          from: { kind: 'pattern', subjects: ['PHYS'], levelMin: 100, levelMax: 199 },
          sourceUrl: SOURCE,
          confidence: 'stated',
        },
        course('micb.scie113', 'SCIE 113'),
        course('micb.dsci100', 'DSCI 100'),
      ],
    },
    {
      id: 'micb.second-year',
      kind: 'group',
      label: 'Second year',
      year: 2,
      sourceUrl: SOURCE,
      items: [
        course('micb.205', 'MICB 205'),
        one('micb.211', 'MICB 211 or 201', ['MICB 211', 'MICB 201']),
        one('micb.212', 'MICB 212 or 202', ['MICB 212', 'MICB 202']),
        course('micb.biol200', 'BIOL 200'),
        course('micb.biol201', 'BIOL 201'),
        course('micb.chem233', 'CHEM 233'),
        course('micb.chem235', 'CHEM 235'),
        {
          id: 'micb.comm-additional',
          kind: 'credits',
          label: 'Communication requirement (approved list)',
          n: 3,
          from: { kind: 'codes', codes: [] },
          sourceUrl: COMM,
          confidence: 'inferred',
        },
      ],
    },
    {
      id: 'micb.third-year',
      kind: 'group',
      label: 'Third year',
      year: 3,
      sourceUrl: SOURCE,
      items: [
        course('micb.301', 'MICB 301'),
        course('micb.302', 'MICB 302'),
        course('micb.322', 'MICB 322'),
        course('micb.323', 'MICB 323'),
        one('micb.325', 'MICB 325 or BIOL 335', ['MICB 325', 'BIOL 335']),
        // The Calendar's "Third or Fourth Year" block. Recorded at year 3,
        // the earliest it permits; a missing prerequisite still pushes it
        // later, which is what "or fourth" means in practice.
        course('micb.bioc302', 'BIOC 302'),
        {
          id: 'micb.selections',
          kind: 'credits',
          label: 'Additional MICB selections',
          n: 9,
          from: {
            kind: 'pattern',
            subjects: ['MICB'],
            levelMin: 300,
            levelMax: 499,
            exclude: ['MICB 301', 'MICB 302', 'MICB 322', 'MICB 323', 'MICB 325'],
          },
          sourceUrl: SOURCE,
          confidence: 'stated',
        },
        {
          id: 'micb.selection-or-other',
          kind: 'credits',
          label: 'A further MICB selection, or BIOC 402/410/421, BIOL 328/421 or CHBE 381',
          n: 3,
          from: {
            kind: 'codes',
            codes: ['BIOC 402', 'BIOC 410', 'BIOC 421', 'BIOL 328', 'BIOL 421', 'CHBE 381'],
          },
          sourceUrl: SOURCE,
          confidence: 'stated',
        },
      ],
    },
    {
      id: 'micb.fourth-year',
      kind: 'group',
      label: 'Fourth year',
      year: 4,
      sourceUrl: SOURCE,
      items: [
        one('micb.471', 'MICB 471, 421 or 447', ['MICB 471', 'MICB 421', 'MICB 447']),
        one('micb.305', 'MICB 305, 401 or 475', ['MICB 305', 'MICB 401', 'MICB 475']),
      ],
    },
    // 4 in first year, 8 in second, and 24 across the upper years.
    { id: 'micb.electives.y1', kind: 'credits', label: 'Electives', n: 4, year: 1,
      from: { kind: 'codes', codes: [] }, sourceUrl: SOURCE, confidence: 'stated' },
    { id: 'micb.electives.y2', kind: 'credits', label: 'Electives', n: 8, year: 2,
      from: { kind: 'codes', codes: [] }, sourceUrl: SOURCE, confidence: 'stated' },
    { id: 'micb.electives.y34', kind: 'credits', label: 'Electives', n: 24, year: 3,
      from: { kind: 'codes', codes: [] }, sourceUrl: SOURCE, confidence: 'stated' },
  ],
};
