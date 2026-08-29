import type { Program, Rule } from '@/guidance/rules';

const SOURCE =
  'https://vancouver.calendar.ubc.ca/faculties-colleges-and-schools/faculty-commerce-and-business-administration/bachelor-commerce/degree-requirements';

const course = (id: string, code: string, year: number): Rule => ({
  id, kind: 'course', label: code, code, year, sourceUrl: SOURCE, confidence: 'stated',
});

/**
 * Bachelor of Commerce core, 2026W — the 106 credits every option shares,
 * inside a 121-credit degree.
 *
 * Two things make this the odd one out among the programs here.
 *
 * The degree is 121 credits, not 120. Second year totals 31 because COMM 202
 * is a one-credit course, and the Calendar's own year tables sum to 121. Every
 * other program transcribed so far lands on 120.
 *
 * And the option is not a major sitting on top of a faculty core — it is 15
 * credits carved out of the third and fourth years, which the core's year
 * tables already reserve. So this core deliberately stops short of them: it
 * holds 106 credits, and the option that extends it supplies exactly 15. The
 * Calendar shows those as 6 credits in third year and 9 in fourth, but each
 * option splits them differently and only the total of 15 is common.
 */
export const commerceCore2026W: Program = {
  code: 'commerce-core-2026w',
  name: 'Bachelor of Commerce: core',
  degree: 'BCom',
  faculty: 'Commerce',
  catalogYear: '2026W',
  extends: [],
  sourceUrl: SOURCE,
  totalCredits: 121,
  rules: [
    {
      id: 'comm.first-year',
      kind: 'group',
      label: 'First year',
      year: 1,
      sourceUrl: SOURCE,
      items: [
        course('comm.econ101', 'ECON 101', 1),
        course('comm.econ102', 'ECON 102', 1),
        course('comm.101', 'COMM 101', 1),
        course('comm.105', 'COMM 105', 1),
        course('comm.190', 'COMM 190', 1),
        course('comm.191', 'COMM 191', 1),
        course('comm.192', 'COMM 192', 1),
        course('comm.196', 'COMM 196', 1),
        {
          // Footnote 3: "Acceptable alternatives are MATH_V 180 or 110."
          // MATH 100 is listed first because it is the 3-credit option the
          // year table is priced on — MATH 180 is 4 credits and MATH 110 is 6,
          // so either changes the year's arithmetic.
          id: 'comm.math',
          kind: 'chooseN',
          label: 'MATH 100, 180 or 110',
          n: 1,
          year: 1,
          sourceUrl: SOURCE,
          confidence: 'stated',
          of: [
            { id: 'comm.math.100', kind: 'course', label: 'MATH 100', code: 'MATH 100' },
            { id: 'comm.math.180', kind: 'course', label: 'MATH 180', code: 'MATH 180' },
            { id: 'comm.math.110', kind: 'course', label: 'MATH 110', code: 'MATH 110' },
          ],
        },
      ],
    },
    {
      id: 'comm.second-year',
      kind: 'group',
      label: 'Second year',
      year: 2,
      sourceUrl: SOURCE,
      items: [
        course('comm.202', 'COMM 202', 2), // 1 credit — the reason the degree is 121
        course('comm.203', 'COMM 203', 2),
        course('comm.204', 'COMM 204', 2),
        course('comm.205', 'COMM 205', 2),
        course('comm.293', 'COMM 293', 2),
        course('comm.294', 'COMM 294', 2),
        {
          // Footnote 5: a student minoring in Economics takes ECON 301
          // instead, and credit is granted for only one of COMM 295,
          // ECON 301 and ECON 304.
          id: 'comm.295',
          kind: 'chooseN',
          label: 'COMM 295, or ECON 301 for an Economics minor',
          n: 1,
          year: 2,
          sourceUrl: SOURCE,
          confidence: 'stated',
          of: [
            { id: 'comm.295.comm', kind: 'course', label: 'COMM 295', code: 'COMM 295' },
            { id: 'comm.295.econ', kind: 'course', label: 'ECON 301', code: 'ECON 301' },
          ],
        },
        course('comm.296', 'COMM 296', 2),
        course('comm.298', 'COMM 298', 2),
      ],
    },
    {
      id: 'comm.third-year',
      kind: 'group',
      label: 'Third year core',
      year: 3,
      sourceUrl: SOURCE,
      items: [
        course('comm.393', 'COMM 393', 3),
        course('comm.394', 'COMM 394', 3),
        course('comm.396', 'COMM 396', 3),
      ],
    },
    {
      id: 'comm.fourth-year',
      kind: 'group',
      label: 'Fourth year core',
      year: 4,
      sourceUrl: SOURCE,
      items: [course('comm.491', 'COMM 491', 4)],
    },
    {
      // "The non-Commerce electives must include at least 3 credits in the
      // humanities, and at least 3 credits in science or social science."
      // The eligible departments live on the Faculty website, not the
      // Calendar, so these reserve the credits without naming courses.
      id: 'comm.humanities',
      kind: 'credits',
      label: 'Humanities: 3 credits of the non-Commerce electives',
      n: 3,
      year: 1,
      from: { kind: 'codes', codes: [] },
      sourceUrl: SOURCE,
      constraint: true,
      confidence: 'stated',
    },
    {
      id: 'comm.science',
      kind: 'credits',
      label: 'Science or social science: 3 credits of the non-Commerce electives',
      n: 3,
      year: 2,
      from: { kind: 'codes', codes: [] },
      sourceUrl: SOURCE,
      constraint: true,
      confidence: 'stated',
    },
    {
      id: 'comm.communications',
      kind: 'note',
      label: 'Business Communications needs 60% in both COMM 196 and 396',
      detail:
        'A pass is not enough for these two. Both are already required above, but the ' +
        'Faculty asks for a minimum grade of 60% in each to qualify for the degree.',
      sourceUrl: SOURCE,
      confidence: 'stated',
    },
    {
      id: 'comm.electives-rule',
      kind: 'note',
      label: 'How the 42 elective credits must be spent',
      detail:
        'At least 27 of the 42 must be non-Commerce, and 12 or more of those must be at ' +
        'the 300 or 400 level. At least 15 of the 42 overall, Commerce or not, must be ' +
        'at the 300 level or higher. Those figures shift with the option: Global Supply ' +
        'Chain and Logistics Management takes 39 elective credits with 12 upper-level, ' +
        'and Operations and Logistics takes 45 with 18.',
      sourceUrl: SOURCE,
      confidence: 'stated',
    },
    {
      id: 'comm.ineligible',
      kind: 'note',
      label: 'Some courses earn no B.Com. credit at all',
      detail:
        'They overlap too far with required Commerce courses: BIOL 300, ECON 226, 325, ' +
        '327 and 466, ENGL 301, EPSE 482 and 483, FRST 231, GEOG 374, KIN 371, MATH 190, ' +
        '230 and 335, POLI 380, PSYC 218, 278 and 366, SOCI 328, STAT 203 and 251, and ' +
        'COMM 220, 320, 321, 420 and 421. Also only one of COMM 337 or CPSC 103; one of ' +
        'COMM 437, COEC 437, CPSC 304 or 368; and one of COMM 439 or CPSC 317. Grades ' +
        'still count toward the sessional average.',
      sourceUrl: SOURCE,
      confidence: 'stated',
    },
    {
      id: 'comm.transfer',
      kind: 'note',
      label: 'Transfer students substitute for three first-year courses',
      detail:
        'COMM 101 is not required of students transferring into second or third year; ' +
        'they take 3 credits of Commerce or non-Commerce instead. STAT 200 is accepted ' +
        'in place of COMM 191, and COMR 329 in place of COMM 192, if completed before ' +
        'entry. At most 50% of degree requirements may come from transfer credit, and ' +
        'every upper-level Commerce core and option core course must be taken while ' +
        'registered in the B.Com.',
      sourceUrl: SOURCE,
      confidence: 'stated',
    },
    {
      id: 'comm.math-note',
      kind: 'note',
      label: 'Specializing in Economics or Computer Science needs MATH 100 and 101',
      detail:
        'The single calculus course above is the minimum. Students heading for Economics ' +
        'or Computer Science must take both MATH 100 and 101 or equivalents, and many ' +
        'electives list them as prerequisites.',
      sourceUrl: SOURCE,
      confidence: 'stated',
    },
    {
      id: 'comm.option-declaration',
      kind: 'note',
      label: 'An option must be declared in third year',
      detail:
        'Every B.Com. student declares one of Accounting, Business Technology Management, ' +
        'Entrepreneurship, Finance, General Business Management, Global Supply Chain and ' +
        'Logistics Management, Marketing, Operations and Logistics, Organizational ' +
        'Behaviour and Human Resources, or Real Estate. Some are self-declared on grades; ' +
        'Finance needs 67% in each of COMM 190, 191, 293, 294, 295 and 298, and ' +
        'Accounting 60% in each of COMM 293 and 294.',
      sourceUrl: SOURCE,
      confidence: 'stated',
    },
    {
      id: 'comm.prerequisites',
      kind: 'note',
      label: 'The 200-level Commerce courses gate almost everything above them',
      detail:
        'The required 200-level courses are generally prerequisite to the 300- and ' +
        '400-level ones, and each option assumes its 300-level courses come before its ' +
        '400-level ones. Anyone off the normal sequence should see an Academic Advisor.',
      sourceUrl: SOURCE,
      confidence: 'stated',
    },
    // 3 + 6 in the first two years, both required to be non-Commerce, then
    // 15 and 18 which may be either. 42 in total.
    {
      id: 'comm.electives.y1', kind: 'credits', label: 'Non-Commerce electives', elective: true,
      n: 3, year: 1, from: { kind: 'pattern', excludeSubjects: ['COMM'] },
      sourceUrl: SOURCE, confidence: 'stated',
    },
    {
      id: 'comm.electives.y2', kind: 'credits', label: 'Non-Commerce electives', elective: true,
      n: 6, year: 2, from: { kind: 'pattern', excludeSubjects: ['COMM'] },
      sourceUrl: SOURCE, confidence: 'stated',
    },
    { id: 'comm.electives.y3', kind: 'credits', label: 'Electives', elective: true, n: 15, year: 3,
      from: { kind: 'codes', codes: [] }, sourceUrl: SOURCE, confidence: 'stated' },
    { id: 'comm.electives.y4', kind: 'credits', label: 'Electives', elective: true, n: 18, year: 4,
      from: { kind: 'codes', codes: [] }, sourceUrl: SOURCE, confidence: 'stated' },
  ],
};
