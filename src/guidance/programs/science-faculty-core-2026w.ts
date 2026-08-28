import type { Program } from '@/guidance/rules';

const SOURCE =
  'https://vancouver.calendar.ubc.ca/faculties-colleges-and-schools/faculty-science/bachelor-science/general-degree-requirements';
const UPPER =
  'https://vancouver.calendar.ubc.ca/faculties-colleges-and-schools/faculty-science/bachelor-science/upper-level-requirement';
const SCIARTS =
  'https://vancouver.calendar.ubc.ca/faculties-colleges-and-schools/faculty-science/bachelor-science/science-and-arts-requirements';
const BREADTH =
  'https://vancouver.calendar.ubc.ca/faculties-colleges-and-schools/faculty-science/bachelor-science/science-breadth-requirement';

/**
 * The seven Science Breadth categories, and the subjects we read each as.
 *
 * The Calendar names the categories; the subject lists are ours. That is the
 * inferred half of these rules, and the reason every branch is marked as such
 * — a student whose course sits in a subject missing from a list will be
 * under-credited rather than over-credited, which is the safe direction.
 */
const BREADTH_CATEGORIES: [string, string, string[]][] = [
  ['math', 'Mathematics', ['MATH']],
  ['chem', 'Chemistry', ['CHEM']],
  ['phys', 'Physics', ['PHYS', 'ASTR']],
  ['life', 'Life Science', ['BIOL', 'BIOC', 'MICB', 'PSYC', 'CAPS']],
  ['stat', 'Statistics', ['STAT']],
  ['cpsc', 'Computer Science', ['CPSC']],
  ['eosc', 'Earth & Planetary Science', ['EOSC', 'ENVR', 'GEOB']],
];

/**
 * Requirements every Faculty of Science BSc major carries, regardless of
 * specialization. Extended by each major rather than copied into it — this is
 * the whole reason `extends` exists. The expensive, exception-ridden breadth
 * modelling is written once here and reused by every Science program.
 *
 * Rules marked `inferred` were not read verbatim off the page above; the
 * Calendar splits Communication, Science Breadth and the lower/upper-level
 * rules onto linked subpages that this transcription has not yet followed.
 * They are recorded as `note` where they cannot be evaluated, so a student
 * sees them and the solver never counts them as met.
 */
export const scienceFacultyCore2026W: Program = {
  code: 'science-faculty-core-2026w',
  name: 'Faculty of Science — general BSc requirements',
  degree: 'BSc',
  faculty: 'Science',
  catalogYear: '2026W',
  extends: [],
  sourceUrl: SOURCE,
  totalCredits: 120,
  rules: [
    {
      id: 'sci.arts',
      kind: 'credits',
      label: 'Arts credits',
      n: 12,
      // Matches Subject.faculty verbatim as the Calendar writes it, which is
      // what scrape:faculties stores — not a friendly short name.
      from: { kind: 'pattern', faculty: 'Faculty of Arts' },
      sourceUrl: SOURCE,
      constraint: true, // spent from electives, not added to them
      // The Calendar adds a trap worth knowing: "Arts credits taken to fulfill
      // the Communication Requirement may not be counted towards the Arts
      // Requirement." The two are separate rules here, so the plan does not
      // double-count them.
      confidence: 'stated', // "At least 12 credits must be in courses offered by the Faculty of Arts"
    },
    {
      id: 'sci.breadth',
      kind: 'chooseN',
      label: 'Science Breadth — 3 credits from any 6 of 7 categories',
      // "Students in a major or honours specialization must successfully
      // complete at least 3 credits from any 6 of the 7 categories."
      n: 6,
      sourceUrl: BREADTH,
      constraint: true, // spent from electives, not added to them
      // The rule and its numbers are stated; the mapping from each named
      // category to subject codes is ours, so a student whose course sits in
      // a subject we did not list will be under-credited here.
      confidence: 'inferred',
      of: BREADTH_CATEGORIES.map(([id, label, subjects]) => ({
        id: `sci.breadth.${id}`,
        kind: 'credits' as const,
        label,
        n: 3,
        // Undergraduate only; 500+ are graduate courses.
        from: { kind: 'pattern' as const, subjects, levelMax: 499 },
        sourceUrl: BREADTH,
        confidence: 'inferred' as const,
      })),
    },
    {
      // "For the B.Sc. major, 30 of the 48 upper-level credits must be in
      // science courses numbered 300 and higher."
      //
      // A constraint, like Arts and breadth: these are 48 of the degree's 120
      // credits spent at the upper level, not 48 on top of it. Shown rather
      // than placed — which specific upper-level courses satisfy it depends
      // on the major's own requirements, and every program here already
      // schedules well over 30 upper-level science credits through its
      // third- and fourth-year rules.
      id: 'sci.upper-level',
      kind: 'note',
      label: 'Upper-level: 48 credits, of which 30 in Science at 300+',
      detail:
        'For the B.Sc. major, 30 of the 48 upper-level credits must be in science ' +
        'courses numbered 300 and higher. Your major requirements cover most of this; ' +
        'the rest comes from how you spend upper-level electives.',
      sourceUrl: UPPER,
      constraint: true,
      confidence: 'stated',
    },
    {
      // "At least 72 credits must be in science courses."
      id: 'sci.science-credits',
      kind: 'note',
      label: 'At least 72 credits in Science',
      detail:
        'Science credit is not simply "any SCIE-faculty course" — the Calendar also ' +
        'counts particular geography and psychology courses, and some from Land and ' +
        'Food Systems and Medicine. Shown rather than counted for that reason.',
      sourceUrl: SCIARTS,
      constraint: true,
      confidence: 'stated',
    },
    {
      id: 'sci.non-science-cap',
      kind: 'note',
      label: 'At most 24 credits outside Science or Arts',
      detail:
        'A cap on where credits may come from rather than a requirement to satisfy. ' +
        'The solver does not place against it; it is shown so a student planning ' +
        'many outside electives is aware of the ceiling.',
      sourceUrl: SOURCE,
      confidence: 'stated', // "At most 24 may be in faculties other than Science or Arts."
    },
    {
      id: 'sci.residency',
      kind: 'note',
      label: 'Residency: at least 50% of credits taken at UBC Vancouver',
      detail:
        'At least 50% of the credits required must be obtained with courses taken ' +
        'while registered in the UBC Vancouver B.Sc. program. Depends on transfer ' +
        'history rather than course selection, so it is shown, not planned.',
      sourceUrl: SOURCE,
      confidence: 'stated',
    },
  ],
};
