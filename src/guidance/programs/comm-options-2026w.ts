import type { Program, Rule } from '@/guidance/rules';

const B =
  'https://vancouver.calendar.ubc.ca/faculties-colleges-and-schools/faculty-commerce-and-business-administration/bachelor-commerce';

/**
 * The B.Com. options, 2026W.
 *
 * Every option is exactly 15 credits on top of the 106-credit core, for a
 * 121-credit degree. The Calendar's core table splits them 6 in third year
 * and 9 in fourth, but that split is nominal — Finance and Marketing put 9 in
 * third year and 6 in fourth, Accounting does the reverse, and General
 * Business Management leaves all 15 to the student. Only the total is common,
 * so each option below distributes its own.
 *
 * They live in one file because they are variations on a single degree rather
 * than separate programs, and reading them side by side is how you check that
 * each still totals 15.
 */

const opt = (
  code: string,
  name: string,
  page: string,
  rules: Rule[],
): Program => ({
  code,
  name,
  degree: 'BCom',
  faculty: 'Commerce',
  catalogYear: '2026W',
  extends: ['commerce-core-2026w'],
  sourceUrl: `${B}/${page}`,
  totalCredits: 121,
  rules,
});

const course = (id: string, code: string, year: number, src: string): Rule => ({
  id, kind: 'course', label: code, code, year, sourceUrl: src, confidence: 'stated',
});

const FIN = `${B}/finance`;
const ACC = `${B}/accounting`;
const MKT = `${B}/marketing`;
const GBM = `${B}/general-business-management`;

/** Finance — COMM 370, 371, 374 in third year, 6 approved credits in fourth. */
export const commFinance2026W = opt('comm-finance-bcom-2026w', 'Commerce: Finance', 'finance', [
  {
    id: 'fin.third-year',
    kind: 'group',
    label: 'Third year option requirements',
    year: 3,
    sourceUrl: FIN,
    items: [
      course('fin.370', 'COMM 370', 3, FIN),
      course('fin.371', 'COMM 371', 3, FIN),
      course('fin.374', 'COMM 374', 3, FIN),
    ],
  },
  {
    // "6 credits from approved finance courses" — footnote 2 puts the list on
    // the Faculty website rather than in the Calendar, so this reserves the
    // credits from upper-level Commerce without naming them.
    id: 'fin.approved',
    kind: 'credits',
    label: 'Approved finance courses: 6 credits',
    n: 6,
    year: 4,
    from: {
      kind: 'pattern', subjects: ['COMM'], levelMin: 300, levelMax: 499,
      exclude: ['COMM 370', 'COMM 371', 'COMM 374', 'COMM 393', 'COMM 394', 'COMM 396', 'COMM 491'],
    },
    sourceUrl: FIN,
    confidence: 'inferred',
  },
  {
    id: 'fin.entry',
    kind: 'note',
    label: 'Finance is self-declared on grades, and has an early-entry route',
    detail:
      'Self-declaration needs at least 67% in each of COMM 190, 191, 293, 294, 295 and ' +
      '298. Students who finish COMM 298 and apply by the end of Term 1 of second year ' +
      'may be accepted for early entry, taking COMM 370 and 371 in Term 2 of second year ' +
      'instead of third. Places are limited.',
    sourceUrl: FIN,
    confidence: 'stated',
  },
  {
    id: 'fin.electives',
    kind: 'note',
    label: 'Further finance courses count as Commerce electives',
    detail:
      'COMM 271, 375, 387 and 486K are finance courses that do not fill the option ' +
      'requirement but may be taken as electives. Check their prerequisites.',
    sourceUrl: FIN,
    confidence: 'stated',
  },
]);

/** Accounting — COMM 353, 354 in third year; 450 plus 6 more in fourth. */
export const commAccounting2026W = opt('comm-accounting-bcom-2026w', 'Commerce: Accounting', 'accounting', [
  {
    id: 'acc.third-year',
    kind: 'group',
    label: 'Third year option requirements',
    year: 3,
    sourceUrl: ACC,
    items: [course('acc.353', 'COMM 353', 3, ACC), course('acc.354', 'COMM 354', 3, ACC)],
  },
  {
    id: 'acc.fourth-year',
    kind: 'group',
    label: 'Fourth year option requirements',
    year: 4,
    sourceUrl: ACC,
    items: [
      course('acc.450', 'COMM 450', 4, ACC),
      {
        id: 'acc.choice',
        kind: 'chooseN',
        label: 'One of COMM 452, 454 or 459',
        n: 1,
        year: 4,
        sourceUrl: ACC,
        confidence: 'stated',
        of: ['COMM 452', 'COMM 454', 'COMM 459'].map((code) => ({
          id: `acc.choice.${code.replace(' ', '')}`,
          kind: 'course' as const,
          label: code,
          code,
        })),
      },
      {
        id: 'acc.upper',
        kind: 'credits',
        label: 'Upper-level accounting: 3 credits',
        n: 3,
        year: 4,
        from: {
          kind: 'pattern', subjects: ['COMM'], levelMin: 300, levelMax: 499,
          exclude: ['COMM 353', 'COMM 354', 'COMM 450', 'COMM 452', 'COMM 454', 'COMM 459',
                    'COMM 393', 'COMM 394', 'COMM 396', 'COMM 491'],
        },
        sourceUrl: ACC,
        confidence: 'inferred',
      },
    ],
  },
  {
    id: 'acc.entry',
    kind: 'note',
    label: 'Accounting is self-declared with 60% in COMM 293 and 294',
    detail:
      'Both are second-year core courses. A required option core course may be retaken ' +
      'once after a failure without appeal; a third attempt needs permission from the ' +
      'Office of Student Academic Services, and a refusal means switching option.',
    sourceUrl: ACC,
    confidence: 'stated',
  },
]);

/** Marketing — COMM 362, 363, 365 in third year; 468 plus 3 more in fourth. */
export const commMarketing2026W = opt('comm-marketing-bcom-2026w', 'Commerce: Marketing', 'marketing', [
  {
    id: 'mkt.third-year',
    kind: 'group',
    label: 'Third year option requirements',
    year: 3,
    sourceUrl: MKT,
    items: [
      course('mkt.362', 'COMM 362', 3, MKT),
      course('mkt.363', 'COMM 363', 3, MKT),
      course('mkt.365', 'COMM 365', 3, MKT),
    ],
  },
  {
    id: 'mkt.fourth-year',
    kind: 'group',
    label: 'Fourth year option requirements',
    year: 4,
    sourceUrl: MKT,
    items: [
      course('mkt.468', 'COMM 468', 4, MKT),
      {
        id: 'mkt.approved',
        kind: 'credits',
        label: 'Approved marketing courses: 3 credits',
        n: 3,
        year: 4,
        from: {
          kind: 'pattern', subjects: ['COMM'], levelMin: 300, levelMax: 499,
          exclude: ['COMM 362', 'COMM 363', 'COMM 365', 'COMM 468',
                    'COMM 393', 'COMM 394', 'COMM 396', 'COMM 491'],
        },
        sourceUrl: MKT,
        confidence: 'inferred',
      },
    ],
  },
  {
    id: 'mkt.365-sequencing',
    kind: 'note',
    label: 'COMM 365 is recommended in third year and gates COMM 468',
    detail:
      'It may be taken in fourth year instead, but it is a prerequisite for COMM 468, so ' +
      'leaving it late forces the two into the same year. The approved marketing list for ' +
      'the remaining 3 credits is on the Faculty website rather than in the Calendar.',
    sourceUrl: MKT,
    confidence: 'stated',
  },
]);

/** General Business Management — 15 flexible credits, 6 of them at the 400 level. */
export const commGeneral2026W = opt(
  'comm-general-bcom-2026w',
  'Commerce: General Business Management',
  'general-business-management',
  [
    {
      id: 'gbm.400',
      kind: 'credits',
      label: 'COMM or COHR at the 400 level: 6 credits',
      n: 6,
      year: 4,
      from: {
        kind: 'pattern', subjects: ['COMM', 'COHR'], levelMin: 400, levelMax: 499,
        exclude: ['COMM 491'],
      },
      sourceUrl: GBM,
      confidence: 'stated',
    },
    {
      id: 'gbm.300',
      kind: 'credits',
      label: 'COMM or COHR at the 300 or 400 level: 9 credits',
      n: 9,
      year: 3,
      from: {
        kind: 'pattern', subjects: ['COMM', 'COHR'], levelMin: 300, levelMax: 499,
        exclude: ['COMM 393', 'COMM 394', 'COMM 396', 'COMM 491'],
      },
      sourceUrl: GBM,
      confidence: 'stated',
    },
    {
      id: 'gbm.list',
      kind: 'note',
      label: 'The eligible course list is on the Faculty website',
      detail:
        'The Calendar states the shape (15 credits of 300- and 400-level COMM or COHR, ' +
        'at least 6 of them at the 400 level) but footnotes the eligible courses to the ' +
        'Faculty website. Any upper-level Commerce course is shown against these credits, ' +
        'so check the list before registering.',
      sourceUrl: GBM,
      confidence: 'stated',
    },
  ],
);
