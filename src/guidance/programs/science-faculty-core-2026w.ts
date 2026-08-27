import type { Program } from '@/guidance/rules';

const SOURCE =
  'https://vancouver.calendar.ubc.ca/faculties-colleges-and-schools/faculty-science/bachelor-science/general-degree-requirements';

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
      kind: 'note',
      label: 'Science Breadth requirement',
      detail:
        'The Faculty of Science requires breadth across science disciplines. The ' +
        'Calendar states this on a linked subpage that has not been transcribed, so ' +
        'it is shown here rather than evaluated. Confirm with an advisor.',
      sourceUrl: SOURCE,
      confidence: 'inferred',
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
