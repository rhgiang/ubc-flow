import type { Program } from '@/guidance/rules';

const SOURCE =
  'https://vancouver.calendar.ubc.ca/faculties-colleges-and-schools/faculty-science/bachelor-science/general-degree-requirements';
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
      // Depends on Subject.faculty, which is unpopulated until phase 0. Until
      // then this resolves to no courses and reads as outstanding, which is
      // the safe direction to be wrong in.
      from: { kind: 'pattern', faculty: 'Arts' },
      sourceUrl: SOURCE,
      confidence: 'stated', // "Minimum Total Arts Credits: 12"
    },
    {
      id: 'sci.breadth',
      kind: 'chooseN',
      label: 'Science Breadth — 3 credits from any 6 of 7 categories',
      // "Students in a major or honours specialization must successfully
      // complete at least 3 credits from any 6 of the 7 categories."
      n: 6,
      sourceUrl: BREADTH,
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
