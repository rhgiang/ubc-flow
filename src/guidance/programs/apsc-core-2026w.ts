import type { Program, Rule } from '@/guidance/rules';

const SOURCE =
  'https://vancouver.calendar.ubc.ca/faculties-colleges-and-schools/faculty-applied-science/bachelor-applied-science/curriculum-and-first-year';
const DEGREE =
  'https://vancouver.calendar.ubc.ca/faculties-colleges-and-schools/faculty-applied-science/bachelor-applied-science/degree-requirements';

const course = (id: string, code: string): Rule => ({
  id, kind: 'course', label: code, code, year: 1, sourceUrl: SOURCE, confidence: 'stated',
});

/**
 * The common first year of the B.A.Sc., 2026W - 37 credits.
 *
 * Engineering is the third shape of faculty core here, and the simplest to
 * state: every student takes the same first year, then enters a department in
 * second year. There is no faculty-wide breadth requirement to model, no Arts
 * minimum, and no free electives at all - the three credits of Complementary
 * Studies are the only choice in the year.
 *
 * It is also the heaviest. 37 credits against the 30 of a B.Sc. or B.A. first
 * year, and the degrees run 148 to 158 credits rather than 120, which is why
 * the Calendar describes the B.A.Sc. as four Winter Sessions "with full credit
 * load" rather than by a credit total.
 */
export const apscCore2026W: Program = {
  code: 'apsc-core-2026w',
  name: 'Applied Science: common first year',
  degree: 'BASc',
  faculty: 'Applied Science',
  catalogYear: '2026W',
  extends: [],
  sourceUrl: SOURCE,
  totalCredits: 37,
  rules: [
    {
      id: 'apsc.first-year',
      kind: 'group',
      label: 'First-year curriculum',
      year: 1,
      sourceUrl: SOURCE,
      items: [
        course('apsc.100', 'APSC 100'),
        course('apsc.101', 'APSC 101'),
        course('apsc.160', 'APSC 160'),
        course('apsc.chem154', 'CHEM 154'),
        // Footnote 2 reads "Or another first-year English course" without
        // naming any, so the alternatives are a note rather than a choice -
        // offering APSC 176 here would put a code in the file that appears on
        // no page the program cites.
        course('apsc.wrds150', 'WRDS 150'),
        course('apsc.math100', 'MATH 100'),
        course('apsc.math101', 'MATH 101'),
        course('apsc.math152', 'MATH 152'),
        course('apsc.phys157', 'PHYS 157'),
        course('apsc.phys158', 'PHYS 158'),
        course('apsc.phys159', 'PHYS 159'), // 1 credit
        course('apsc.phys170', 'PHYS 170'),
        {
          id: 'apsc.complementary.y1',
          kind: 'credits',
          label: 'Complementary Studies electives',
          n: 3,
          year: 1,
          // The approved lists live on the Engineering Academic Services
          // electives page, not in the Calendar.
          from: { kind: 'codes', codes: [] },
          sourceUrl: SOURCE,
          confidence: 'stated',
        },
      ],
    },
    {
      id: 'apsc.english-requirement',
      kind: 'note',
      label: 'English: WRDS 150 plus an approved technical communication course',
      detail:
        'The first-year table names WRDS 150 and footnotes it "or another first-year ' +
        'English course" without listing them. Mechanical, for one, accepts ENGL 112 or ' +
        'APSC 176 in its place. Both are needed to qualify for the B.A.Sc. Students admitted from secondary ' +
        'school must take English in first year if eligible, and once admitted may not ' +
        'normally satisfy the English requirement at another institution. Anyone planning ' +
        'to apply to medical school needs 6 credits of ENGL and should spend a humanities ' +
        'elective on it.',
      sourceUrl: DEGREE,
      confidence: 'stated',
    },
    {
      id: 'apsc.complementary-studies',
      kind: 'note',
      label: 'Complementary Studies: 20 credits across seven elements',
      detail:
        'Engineering economics and project management, minimum 3 credits. Humanities and ' +
        'social sciences electives, minimum 6. Oral and written communication, minimum 6. ' +
        'Professionalism, ethics, equity and law, minimum 2. Health and safety, which is ' +
        'integrated into core courses. And impact of technology on society together with ' +
        'sustainable development and environmental stewardship, minimum 3 combined. Some ' +
        'of the 20 are already inside core courses in some programs, and the approved ' +
        'lists are on the Engineering Academic Services electives page rather than in the ' +
        'Calendar.',
      sourceUrl: DEGREE,
      constraint: true,
      confidence: 'stated',
    },
    {
      id: 'apsc.full-load',
      kind: 'note',
      label: 'The degree is defined by its courses, not by a credit total',
      detail:
        'A B.A.Sc. is granted after credit for every course in the program of study. That ' +
        'is normally four Winter Sessions at full credit load, five for Engineering ' +
        'Physics, and nine academic terms for Biomedical Engineering. Part-time study ' +
        'needs the Dean’s Office. Programs change year to year to keep engineering ' +
        'accreditation, so confirm against the Calendar for your entry year.',
      sourceUrl: DEGREE,
      confidence: 'stated',
    },
    {
      id: 'apsc.transfer',
      kind: 'note',
      label: 'The transfer route from first-year Science is a different 30 credits',
      detail:
        'Students coming from a first year of science take APSC 100, 160 and 201, ' +
        'MATH 152, 253 and 255, PHYS 170, STAT 251 and 6 credits of Complementary ' +
        'Studies, 30 credits rather than 37. More than 26 credits of engineering ' +
        'transfer credit can mean entering second year directly.',
      sourceUrl: SOURCE,
      confidence: 'stated',
    },
    {
      id: 'apsc.registration',
      kind: 'note',
      label: 'Course registration can be restricted',
      detail:
        'The Faculty may limit registration to students in the B.A.Sc. program and ' +
        'prioritise by progression and graduation requirements, and enrolment in ' +
        'engineering elective courses may be restricted.',
      sourceUrl: DEGREE,
      confidence: 'stated',
    },
  ],
};
