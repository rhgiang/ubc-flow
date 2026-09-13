import type { Program, Rule } from '@/guidance/rules';

const B =
  'https://vancouver.calendar.ubc.ca/faculties-colleges-and-schools/faculty-applied-science/bachelor-applied-science';

/**
 * Four B.A.Sc. programs, 2026W - Mechanical, Electrical, Civil, and Chemical
 * and Biological Engineering.
 *
 * They share the 37-credit common first year and then diverge completely, so
 * they sit together here the way the B.Com. options do: the thing worth
 * checking is that each year still adds up to the Calendar's own total, and
 * that is easiest to see side by side.
 *
 * Engineering totals are unlike anything else transcribed here. Mechanical is
 * 148 credits, Electrical 151, Chemical and Biological 155, Civil 158, against
 * 120 for a B.Sc. or B.A. and 121 for the B.Com. There are no free electives
 * anywhere in them - every elective is technical or complementary and drawn
 * from a departmental list.
 */

const prog = (code: string, name: string, page: string, total: number, rules: Rule[]): Program => ({
  code,
  name,
  degree: 'BASc',
  faculty: 'Applied Science',
  catalogYear: '2026W',
  extends: ['apsc-core-2026w'],
  sourceUrl: `${B}/${page}`,
  totalCredits: total,
  rules,
});

/** A required course. Engineering credits vary widely, so they come from the catalogue. */
const c = (id: string, code: string, year: number, src: string): Rule => ({
  id, kind: 'course', label: code, code, year, sourceUrl: src, confidence: 'stated',
});

/**
 * A required course the PROGRAM prices differently from the catalogue.
 *
 * UBC's variable-credit courses - CPEN 221 is "(4-5)", ELEC 491 and CPEN 491
 * are "(5-10)" - are stored at the bottom of their range, while the program
 * tables require the top. It has to stay a course rather than become a credits
 * rule: a credits rule plans as a slot, slots never enter the satisfied set,
 * and CPEN 212, 331 and 391 all depend on CPEN 221 having been taken.
 */
const cAt = (id: string, code: string, year: number, src: string, credits: number): Rule => ({
  id, kind: 'course', label: code, code, year, credits, sourceUrl: src, confidence: 'stated',
});

/** Technical or complementary electives - restricted lists held by departments. */
const el = (id: string, label: string, n: number, year: number, src: string): Rule => ({
  id, kind: 'credits', label, n, year,
  from: { kind: 'codes', codes: [] },
  sourceUrl: src, confidence: 'stated',
});

const MECH = `${B}/mechanical-engineering`;
const ELEC = `${B}/electrical-and-computer-engineering`;
const CIVL = `${B}/civil-engineering`;
const CHBE = `${B}/chemical-and-biological-engineering`;

/**
 * Mechanical - 37 + 40 + 35 + 36 = 148.
 *
 * Second year is "Mech 2", a single block that starts a week before term and
 * runs as one programme; MECH 220 is taken before Term 1 even begins.
 */
export const mechMajor2026W = prog('mech-basc-2026w', 'Mechanical Engineering', 'mechanical-engineering', 148, [
  {
    id: 'mech.second-year',
    kind: 'group',
    label: 'Second year (Mech 2)',
    year: 2,
    sourceUrl: MECH,
    items: [
      c('mech.math254', 'MATH 254', 2, MECH),
      c('mech.math258', 'MATH 258', 2, MECH),
      c('mech.220', 'MECH 220', 2, MECH), // taken before Term 1 starts
      c('mech.221', 'MECH 221', 2, MECH), // 12 credits
      c('mech.222', 'MECH 222', 2, MECH),
      c('mech.223', 'MECH 223', 2, MECH),
      c('mech.224', 'MECH 224', 2, MECH),
      c('mech.225', 'MECH 225', 2, MECH),
      {
        // 3 credits or 5, and the year total is stated as "40 or 42" for
        // exactly that reason. MECH 226 is listed first, which is the 40.
        id: 'mech.226',
        kind: 'chooseN',
        label: 'MECH 226, or MECH 227 in the summer after second year',
        n: 1,
        year: 2,
        sourceUrl: MECH,
        confidence: 'stated',
        of: [
          { id: 'mech.226.226', kind: 'course', label: 'MECH 226', code: 'MECH 226' },
          { id: 'mech.226.227', kind: 'course', label: 'MECH 227', code: 'MECH 227' },
        ],
      },
    ],
  },
  {
    id: 'mech.third-year',
    kind: 'group',
    label: 'Third year',
    year: 3,
    sourceUrl: MECH,
    items: [
      c('mech.305', 'MECH 305', 3, MECH),
      c('mech.325', 'MECH 325', 3, MECH),
      c('mech.328', 'MECH 328', 3, MECH),
      c('mech.360', 'MECH 360', 3, MECH),
      c('mech.368', 'MECH 368', 3, MECH),
      c('mech.375', 'MECH 375', 3, MECH),
      el('mech.tech.y3', 'Technical electives', 6, 3, MECH),
      el('mech.comp.y3', 'Complementary Studies electives', 6, 3, MECH),
    ],
  },
  {
    id: 'mech.fourth-year',
    kind: 'group',
    label: 'Fourth year',
    year: 4,
    sourceUrl: MECH,
    items: [
      c('mech.400', 'MECH 400', 4, MECH),
      c('mech.431', 'MECH 431', 4, MECH),
      c('mech.457', 'MECH 457', 4, MECH),
      c('mech.463', 'MECH 463', 4, MECH),
      c('mech.466', 'MECH 466', 4, MECH),
      el('mech.tech.y4', 'Technical electives', 16, 4, MECH),
    ],
  },
  {
    id: 'mech.sequence',
    kind: 'note',
    label: 'The Calendar prints a second ordering for co-op students',
    detail:
      'The same courses, with MECH 466 moved into third year and the technical electives ' +
      'rebalanced to 36 credits in third year and 35 in fourth instead of 35 and 36. The ' +
      'Calendar notes that students will not always take courses in the order shown, ' +
      'depending on their co-op schedule, and points at the Department website for ' +
      'recommended sequences.',
    sourceUrl: MECH,
    confidence: 'stated',
  },
  {
    id: 'mech.mech2',
    kind: 'note',
    label: 'Mech 2 starts a week early and has a hard prerequisite deadline',
    detail:
      'Attendance for the whole programme including the first week is mandatory. Credit ' +
      'for APSC 160, MATH 100, 101 and 152, PHYS 157, 158 and 170, one of PHYS 159 or ' +
      'BMEG 102, and one of ENGL 112, WRDS 150 or APSC 176 must be in hand by August 1st. ' +
      'Missing that forfeits the Mech 2 seat until a year when the deadline is met.',
    sourceUrl: MECH,
    confidence: 'stated',
  },
  {
    id: 'mech.options',
    kind: 'note',
    label: 'Six options are available from the end of second year',
    detail:
      'Aerospace, Biomechanics and Medical Devices, Energy and Environment, Mechatronics, ' +
      'Naval Architecture and Marine Engineering, and Thermofluids. Admission is by the ' +
      'option coordinator on an application showing achievement and interest. Each ' +
      'replaces part of the third and fourth years above; none are transcribed here.',
    sourceUrl: MECH,
    confidence: 'stated',
  },
  {
    id: 'mech.457-substitution',
    kind: 'note',
    label: 'MECH 457 may be replaced by APSC 486 and MECH 490',
    detail: 'With permission from the Department. Technical elective lists are on the Department website.',
    sourceUrl: MECH,
    confidence: 'stated',
  },
]);

/** Electrical - 37 + 39 + 39 + 36 = 151. */
export const elecMajor2026W = prog('elec-basc-2026w', 'Electrical Engineering', 'electrical-and-computer-engineering', 151, [
  {
    id: 'elec.second-year',
    kind: 'group',
    label: 'Second year',
    year: 2,
    sourceUrl: ELEC,
    items: [
      c('elec.cpen211', 'CPEN 211', 2, ELEC),
      c('elec.cpsc259', 'CPSC 259', 2, ELEC),
      c('elec.201', 'ELEC 201', 2, ELEC),
      c('elec.202', 'ELEC 202', 2, ELEC),
      c('elec.211', 'ELEC 211', 2, ELEC),
      c('elec.221', 'ELEC 221', 2, ELEC),
      {
        id: 'elec.281',
        kind: 'chooseN',
        label: 'ELEC 281 or CPEN 281',
        n: 1,
        year: 2,
        sourceUrl: ELEC,
        confidence: 'stated',
        of: [
          { id: 'elec.281.elec', kind: 'course', label: 'ELEC 281', code: 'ELEC 281' },
          { id: 'elec.281.cpen', kind: 'course', label: 'CPEN 281', code: 'CPEN 281' },
        ],
      },
      c('elec.291', 'ELEC 291', 2, ELEC),
      c('elec.math253', 'MATH 253', 2, ELEC),
      c('elec.math255', 'MATH 255', 2, ELEC),
      c('elec.math264', 'MATH 264', 2, ELEC),
    ],
  },
  {
    id: 'elec.third-year',
    kind: 'group',
    label: 'Third year',
    year: 3,
    sourceUrl: ELEC,
    items: [
      c('elec.301', 'ELEC 301', 3, ELEC),
      c('elec.311', 'ELEC 311', 3, ELEC),
      c('elec.315', 'ELEC 315', 3, ELEC),
      c('elec.341', 'ELEC 341', 3, ELEC),
      c('elec.342', 'ELEC 342', 3, ELEC),
      c('elec.391', 'ELEC 391', 3, ELEC),
      {
        id: 'elec.stats',
        kind: 'chooseN',
        label: 'One of MATH 318, MATH 302 or STAT 302',
        n: 1,
        year: 3,
        sourceUrl: ELEC,
        confidence: 'stated',
        of: ['MATH 318', 'MATH 302', 'STAT 302'].map((code) => ({
          id: `elec.stats.${code.replace(' ', '')}`,
          kind: 'course' as const,
          label: code,
          code,
        })),
      },
      el('elec.tech.y3', 'Electrical Engineering electives', 4, 3, ELEC),
      el('elec.comp.y3', 'Complementary Studies electives', 6, 3, ELEC),
    ],
  },
  {
    id: 'elec.fourth-year',
    kind: 'group',
    label: 'Fourth year',
    year: 4,
    sourceUrl: ELEC,
    items: [
      c('elec.apsc450', 'APSC 450', 4, ELEC),
      {
        id: 'elec.481',
        kind: 'chooseN',
        label: 'ELEC 481 or CPEN 481',
        n: 1,
        year: 4,
        sourceUrl: ELEC,
        confidence: 'stated',
        of: [
          { id: 'elec.481.elec', kind: 'course', label: 'ELEC 481', code: 'ELEC 481' },
          { id: 'elec.481.cpen', kind: 'course', label: 'CPEN 481', code: 'CPEN 481' },
        ],
      },
      cAt('elec.491', 'ELEC 491', 4, ELEC, 10), // (5-10) on the page, 10 in the table
      el('elec.tech.y4', 'Electrical Engineering electives', 18, 4, ELEC),
      el('elec.science.y4', 'Science elective', 3, 4, ELEC),
    ],
  },
  {
    id: 'elec.491-credits',
    kind: 'note',
    label: 'ELEC 491 is a variable-credit course',
    detail:
      'The course descriptions list it as 5 to 10 credits; the Electrical Engineering ' +
      'program table requires the full 10, which is the figure used above.',
    sourceUrl: ELEC,
    confidence: 'stated',
  },
  {
    id: 'elec.computer-engineering',
    kind: 'note',
    label: 'Computer Engineering is a separate program in the same department',
    detail:
      'It shares CPEN 211, 212, 281 and ELEC 201 in second year but swaps in CPEN 221, ' +
      'CPSC 221, MATH 220 and 256, then runs CPEN 331, 391 and 491 with CPSC 320 above ' +
      'that. Students who entered second year in 2022W or earlier follow a different ' +
      'table again. Not transcribed here.',
    sourceUrl: ELEC,
    confidence: 'stated',
  },
  {
    id: 'elec.biomedical',
    kind: 'note',
    label: 'There is also a Biomedical Engineering Option',
    detail:
      'It replaces ELEC 291 with ELEC 271 and 292 in second year, and swaps much of third ' +
      'and fourth year for BMEG courses and ELEC 494. Not transcribed here.',
    sourceUrl: ELEC,
    confidence: 'stated',
  },
]);

/**
 * Computer Engineering - 37 + 38 + 38 + 38 = 151.
 *
 * Shares a department and a Calendar page with Electrical, and about half its
 * second year, but diverges completely above that: CPSC 221 and 320 in place
 * of the circuits stream, and CPEN's own 331, 391 and 491.
 *
 * The Calendar prints two second-year tables, for students who entered in
 * 2022W or earlier and in 2023W or later. The later one is transcribed.
 */
export const cpenMajor2026W = prog('cpen-basc-2026w', 'Computer Engineering', 'electrical-and-computer-engineering', 151, [
  {
    id: 'cpen.second-year',
    kind: 'group',
    label: 'Second year',
    year: 2,
    sourceUrl: ELEC,
    items: [
      c('cpen.211', 'CPEN 211', 2, ELEC),
      cAt('cpen.221', 'CPEN 221', 2, ELEC, 5), // (4-5) on the page, 5 in the table
      {
        id: 'cpen.281',
        kind: 'chooseN',
        label: 'CPEN 281 or ELEC 281',
        n: 1,
        year: 2,
        sourceUrl: ELEC,
        confidence: 'stated',
        of: [
          { id: 'cpen.281.cpen', kind: 'course', label: 'CPEN 281', code: 'CPEN 281' },
          { id: 'cpen.281.elec', kind: 'course', label: 'ELEC 281', code: 'ELEC 281' },
        ],
      },
      c('cpen.cpsc221', 'CPSC 221', 2, ELEC),
      c('cpen.212', 'CPEN 212', 2, ELEC),
      c('cpen.elec201', 'ELEC 201', 2, ELEC),
      c('cpen.math220', 'MATH 220', 2, ELEC),
      c('cpen.math253', 'MATH 253', 2, ELEC),
      c('cpen.math255', 'MATH 255', 2, ELEC),
      el('cpen.tech.y2', 'Computer Engineering electives', 4, 2, ELEC),
    ],
  },
  {
    id: 'cpen.third-year',
    kind: 'group',
    label: 'Third year',
    year: 3,
    sourceUrl: ELEC,
    items: [
      c('cpen.331', 'CPEN 331', 3, ELEC),
      c('cpen.391', 'CPEN 391', 3, ELEC),
      c('cpen.cpsc320', 'CPSC 320', 3, ELEC),
      {
        id: 'cpen.stats',
        kind: 'chooseN',
        label: 'One of MATH 318, STAT 251, MATH 302 or STAT 302',
        n: 1,
        year: 3,
        sourceUrl: ELEC,
        confidence: 'stated',
        of: ['MATH 318', 'STAT 251', 'MATH 302', 'STAT 302'].map((code) => ({
          id: `cpen.stats.${code.replace(' ', '')}`,
          kind: 'course' as const,
          label: code,
          code,
        })),
      },
      el('cpen.tech.y3', 'Computer Engineering electives', 16, 3, ELEC),
      el('cpen.comp.y3', 'Complementary Studies electives', 6, 3, ELEC),
    ],
  },
  {
    id: 'cpen.fourth-year',
    kind: 'group',
    label: 'Fourth year',
    year: 4,
    sourceUrl: ELEC,
    items: [
      c('cpen.apsc450', 'APSC 450', 4, ELEC),
      {
        id: 'cpen.481',
        kind: 'chooseN',
        label: 'CPEN 481 or ELEC 481',
        n: 1,
        year: 4,
        sourceUrl: ELEC,
        confidence: 'stated',
        of: [
          { id: 'cpen.481.cpen', kind: 'course', label: 'CPEN 481', code: 'CPEN 481' },
          { id: 'cpen.481.elec', kind: 'course', label: 'ELEC 481', code: 'ELEC 481' },
        ],
      },
      cAt('cpen.491', 'CPEN 491', 4, ELEC, 10), // (5-10) on the page, 10 in the table
      el('cpen.tech.y4', 'Computer Engineering electives', 20, 4, ELEC),
      el('cpen.science.y4', 'Science elective', 3, 4, ELEC),
    ],
  },
  {
    id: 'cpen.variable-credits',
    kind: 'note',
    label: 'CPEN 221 and 491 are variable-credit courses',
    detail:
      'The course descriptions list CPEN 221 as 4 to 5 credits and CPEN 491 as 5 to 10. ' +
      'The program table requires the top of each range, which is what is used above.',
    sourceUrl: ELEC,
    confidence: 'stated',
  },
  {
    id: 'cpen.entry-year',
    kind: 'note',
    label: 'A different second year applies if you entered before 2023W',
    detail:
      'That table has CPEN 221 at 4 credits, adds CPEN 291, and takes MATH 256 instead ' +
      'of MATH 255, so 39 credits rather than 38, with no second-year electives. Students ' +
      'who entered second year in 2022W or earlier should follow it instead.',
    sourceUrl: ELEC,
    confidence: 'stated',
  },
]);

/** Civil - 37 + 45 + 40 + 36 = 158, the largest degree here. */
export const civlMajor2026W = prog('civl-basc-2026w', 'Civil Engineering', 'civil-engineering', 158, [
  {
    id: 'civl.second-year',
    kind: 'group',
    label: 'Second year',
    year: 2,
    sourceUrl: CIVL,
    items: [
      c('civl.apsc278', 'APSC 278', 2, CIVL),
      c('civl.apsc279', 'APSC 279', 2, CIVL),
      c('civl.201', 'CIVL 201', 2, CIVL),
      c('civl.203', 'CIVL 203', 2, CIVL),
      c('civl.204', 'CIVL 204', 2, CIVL),
      c('civl.210', 'CIVL 210', 2, CIVL),
      c('civl.215', 'CIVL 215', 2, CIVL),
      c('civl.230', 'CIVL 230', 2, CIVL),
      c('civl.231', 'CIVL 231', 2, CIVL),
      c('civl.235', 'CIVL 235', 2, CIVL), // end of Term 2
      c('civl.eosc210', 'EOSC 210', 2, CIVL),
      c('civl.math253', 'MATH 253', 2, CIVL),
      c('civl.math256', 'MATH 256', 2, CIVL),
      c('civl.stat251', 'STAT 251', 2, CIVL),
    ],
  },
  {
    id: 'civl.third-year',
    kind: 'group',
    label: 'Third year',
    year: 3,
    sourceUrl: CIVL,
    items: [
      c('civl.300', 'CIVL 300', 3, CIVL),
      c('civl.301', 'CIVL 301', 3, CIVL),
      c('civl.302', 'CIVL 302', 3, CIVL), // satisfies impact of technology on society
      c('civl.303', 'CIVL 303', 3, CIVL),
      c('civl.305', 'CIVL 305', 3, CIVL),
      c('civl.311', 'CIVL 311', 3, CIVL),
      c('civl.315', 'CIVL 315', 3, CIVL),
      c('civl.316', 'CIVL 316', 3, CIVL),
      c('civl.320', 'CIVL 320', 3, CIVL),
      c('civl.331', 'CIVL 331', 3, CIVL),
      c('civl.332', 'CIVL 332', 3, CIVL),
      c('civl.340', 'CIVL 340', 3, CIVL),
    ],
  },
  {
    id: 'civl.fourth-year',
    kind: 'group',
    label: 'Fourth year',
    year: 4,
    sourceUrl: CIVL,
    items: [
      c('civl.402', 'CIVL 402', 4, CIVL), // counts toward professional development
      c('civl.403', 'CIVL 403', 4, CIVL),
      c('civl.409', 'CIVL 409', 4, CIVL),
      c('civl.430', 'CIVL 430', 4, CIVL),
      c('civl.445', 'CIVL 445', 4, CIVL),
      c('civl.446', 'CIVL 446', 4, CIVL),
      el('civl.tech.y4', 'Technical electives', 15, 4, CIVL),
      el('civl.comp.y4', 'Complementary Studies electives', 3, 4, CIVL),
    ],
  },
  {
    id: 'civl.embedded',
    kind: 'note',
    label: 'Two core courses double as Complementary Studies',
    detail:
      'CIVL 302 satisfies the impact-of-technology-on-society element, and CIVL 402 ' +
      'counts toward the professional development requirement. That is why only 3 credits ' +
      'of Complementary Studies electives appear in fourth year on top of the 3 in first.',
    sourceUrl: CIVL,
    confidence: 'stated',
  },
  {
    id: 'civl.streams',
    kind: 'note',
    label: 'The 15 technical elective credits come in streams',
    detail:
      'The Calendar points at a fourth-year technical elective list where several streams ' +
      'are possible, rather than naming courses. CIVL 235 is taken at the end of Term 2 of ' +
      'second year.',
    sourceUrl: CIVL,
    confidence: 'stated',
  },
]);

/** Chemical and Biological - 37 + 39 + 40 + 39 = 155. */
export const chbeMajor2026W = prog('chbe-basc-2026w', 'Chemical and Biological Engineering', 'chemical-and-biological-engineering', 155, [
  {
    id: 'chbe.second-year',
    kind: 'group',
    label: 'Second year',
    year: 2,
    sourceUrl: CHBE,
    items: [
      c('chbe.201', 'CHBE 201', 2, CHBE),
      c('chbe.220', 'CHBE 220', 2, CHBE),
      c('chbe.221', 'CHBE 221', 2, CHBE),
      c('chbe.230', 'CHBE 230', 2, CHBE),
      c('chbe.241', 'CHBE 241', 2, CHBE),
      c('chbe.244', 'CHBE 244', 2, CHBE),
      c('chbe.251', 'CHBE 251', 2, CHBE),
      c('chbe.263', 'CHBE 263', 2, CHBE),
      c('chbe.264', 'CHBE 264', 2, CHBE),
      c('chbe.chem250', 'CHEM 250', 2, CHBE),
      c('chbe.chem260', 'CHEM 260', 2, CHBE),
      c('chbe.math253', 'MATH 253', 2, CHBE),
      c('chbe.math256', 'MATH 256', 2, CHBE),
    ],
  },
  {
    id: 'chbe.third-year',
    kind: 'group',
    label: 'Third year',
    year: 3,
    sourceUrl: CHBE,
    items: [
      c('chbe.345', 'CHBE 345', 3, CHBE),
      c('chbe.346', 'CHBE 346', 3, CHBE),
      c('chbe.352', 'CHBE 352', 3, CHBE),
      c('chbe.355', 'CHBE 355', 3, CHBE),
      c('chbe.356', 'CHBE 356', 3, CHBE),
      c('chbe.362', 'CHBE 362', 3, CHBE),
      c('chbe.370', 'CHBE 370', 3, CHBE),
      c('chbe.376', 'CHBE 376', 3, CHBE),
      c('chbe.stat251', 'STAT 251', 3, CHBE),
      el('chbe.comp.y3', 'Complementary Studies electives', 3, 3, CHBE),
      {
        // The two streams diverge here and again in fourth year. Chemical and
        // Biological is listed second on the page but names the department, so
        // it leads; both branches are 6 credits either way.
        id: 'chbe.stream.y3',
        kind: 'chooseN',
        label: 'Chemical and Biological, or Chemical Engineering',
        n: 1,
        year: 3,
        sourceUrl: CHBE,
        confidence: 'stated',
        of: [
          {
            id: 'chbe.stream.y3.bio',
            kind: 'group',
            label: 'Chemical and Biological: CHBE 365 and 381',
            items: [
              { id: 'chbe.365', kind: 'course', label: 'CHBE 365', code: 'CHBE 365' },
              { id: 'chbe.381', kind: 'course', label: 'CHBE 381', code: 'CHBE 381' },
            ],
          },
          {
            id: 'chbe.stream.y3.chem',
            kind: 'group',
            label: 'Chemical: APSC 278 and CHBE 366',
            items: [
              { id: 'chbe.apsc278', kind: 'course', label: 'APSC 278', code: 'APSC 278' },
              { id: 'chbe.366', kind: 'course', label: 'CHBE 366', code: 'CHBE 366' },
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'chbe.fourth-year',
    kind: 'group',
    label: 'Fourth year',
    year: 4,
    sourceUrl: CHBE,
    items: [
      c('chbe.apsc450', 'APSC 450', 4, CHBE),
      c('chbe.456', 'CHBE 456', 4, CHBE),
      c('chbe.459', 'CHBE 459', 4, CHBE),
      c('chbe.464', 'CHBE 464', 4, CHBE),
      el('chbe.comp.y4', 'Complementary Studies electives', 3, 4, CHBE),
      {
        id: 'chbe.stream.y4',
        kind: 'chooseN',
        label: 'Chemical and Biological, or Chemical Engineering',
        n: 1,
        year: 4,
        sourceUrl: CHBE,
        confidence: 'stated',
        of: [
          {
            id: 'chbe.stream.y4.bio',
            kind: 'group',
            label: 'Chemical and Biological: CHBE 453 and 481',
            items: [
              { id: 'chbe.453', kind: 'course', label: 'CHBE 453', code: 'CHBE 453' },
              { id: 'chbe.481', kind: 'course', label: 'CHBE 481', code: 'CHBE 481' },
            ],
          },
          {
            id: 'chbe.stream.y4.chem',
            kind: 'group',
            label: 'Chemical: CHBE 454 and 471',
            items: [
              { id: 'chbe.454', kind: 'course', label: 'CHBE 454', code: 'CHBE 454' },
              { id: 'chbe.471', kind: 'course', label: 'CHBE 471', code: 'CHBE 471' },
            ],
          },
        ],
      },
      el('chbe.tech.y4', 'Technical electives', 12, 4, CHBE),
    ],
  },
  {
    id: 'chbe.streams',
    kind: 'note',
    label: 'One department, two degrees',
    detail:
      'Chemical Engineering and Chemical and Biological Engineering share every course ' +
      'above except four: the third-year pair and the fourth-year pair chosen together. ' +
      'Pick the same stream in both years, or the plan will otherwise mix them.',
    sourceUrl: CHBE,
    confidence: 'stated',
  },
  {
    id: 'chbe.complementary-course',
    kind: 'note',
    label: 'The Complementary Studies credits are APSC 262',
    detail:
      'The Calendar asks for 3 credits of Complementary Studies electives in third year ' +
      'and 3 more in fourth. The Department’s own curriculum names APSC 262, Technology ' +
      'and Society, for the third-year one, in Term 2 for Chemical Engineering and Term 1 ' +
      'for Chemical and Biological. It is left as a generic slot above because the ' +
      'Calendar page this program cites does not name it.',
    sourceUrl: CHBE,
    confidence: 'inferred',
  },
  {
    id: 'chbe.technical-electives',
    kind: 'note',
    label: 'Half the technical electives must be CHBE',
    detail:
      'At least 6 of the 12 technical elective credits must come from CHBE courses, off ' +
      'the Department-approved list. And students who took CHBE 356 before 2021W must ' +
      'spend 3 of those credits on CHBE 474 specifically.',
    sourceUrl: CHBE,
    confidence: 'stated',
  },
  {
    id: 'chbe.credit-changes',
    kind: 'note',
    label: 'Three courses changed credit value in 2021W',
    detail:
      'CHBE 453 and 454 went from 6 credits to 8, and CHBE 481 from 3 to 4. The values ' +
      'used above are the current ones, so a student who started earlier should check ' +
      'their own year’s curriculum.',
    sourceUrl: CHBE,
    confidence: 'stated',
  },
]);
