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
 * The seven Science Breadth categories, verbatim from the Calendar.
 *
 * These were first written from memory of what each category "obviously"
 * meant, and marked `inferred` to say so. That was wrong twice over: the
 * Calendar states the subject lists precisely, and the guesses had real
 * errors in them. ASTR sat under Physics when it belongs to Earth & Planetary
 * Science; CAPS sat under Life Science, which lists no CAPS at all (CAPS
 * carries science credit, a different rule); and ATSC, GEOS, AI and DSCI were
 * missing outright, so an Atmospheric Science or Data Science course counted
 * toward nothing.
 *
 * GEOB does not exist as a subject in the catalogue — the Calendar writes
 * "GEOS_V (or GEOB_V)" for one course under its current and former codes, and
 * GEOS is the live one.
 */
const BREADTH_CATEGORIES: [string, string, string[], string[]][] = [
  ['math', 'Mathematics', ['MATH'], ['MATH 302']],
  ['chem', 'Chemistry', ['CHEM'], ['CHEM 100', 'CHEM 300']],
  ['phys', 'Physics', ['PHYS'], ['PHYS 100']],
  // Also GEOS 207, which cannot join a subject list without dragging in the
  // rest of GEOS — see the note on the breadth rule.
  ['life', 'Life Science', ['BIOL', 'BIOC', 'PSYC', 'MICB'], ['BIOL 140', 'BIOL 300']],
  // Also BIOL 300, DSCI 100 and MATH 302 — likewise, see the note.
  ['stat', 'Statistics', ['STAT'], []],
  ['cpsc', 'Computer Science', ['CPSC', 'AI'], []],
  [
    'eosc',
    'Earth & Planetary Science',
    ['ASTR', 'ATSC', 'ENVR', 'EOSC', 'GEOS'],
    ['EOSC 111', 'GEOS 207'],
  ],
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
  name: 'Faculty of Science: general BSc requirements',
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
      //
      // GEOS is excluded because the Calendar excludes it: Geography sits in
      // the Faculty of Arts, so a bare faculty pattern counted Geographical
      // Sciences courses toward the Arts requirement when they carry science
      // credit instead. PSYC is the same trap and cannot be fixed the same
      // way — only the psychology courses numbered 60 to 89 in the last two
      // digits carry science credit, and the rest do count as Arts. That half
      // is recorded in the note below rather than enforced.
      from: { kind: 'pattern', faculty: 'Faculty of Arts', excludeSubjects: ['GEOS'] },
      sourceUrl: SCIARTS,
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
      label: 'Science Breadth: 3 credits from any 6 of 7 categories',
      // "Students in a major or honours specialization must successfully
      // complete at least 3 credits from any 6 of the 7 categories."
      n: 6,
      sourceUrl: BREADTH,
      constraint: true, // spent from electives, not added to them
      confidence: 'stated',
      of: BREADTH_CATEGORIES.map(([id, label, subjects, exclude]) => ({
        id: `sci.breadth.${id}`,
        kind: 'credits' as const,
        label,
        n: 3,
        // Undergraduate only; 500+ are graduate courses.
        from: { kind: 'pattern' as const, subjects, exclude, levelMax: 499 },
        sourceUrl: BREADTH,
        confidence: 'stated' as const,
      })),
    },
    {
      id: 'sci.breadth.exceptions',
      kind: 'note',
      label: 'Science Breadth: four exceptions not enforced above',
      detail:
        'A category is one course set here, so four pieces of the Calendar’s wording ' +
        'cannot be expressed and are listed instead. Statistics also accepts BIOL 300, ' +
        'DSCI 100 and MATH 302. Life Science also accepts GEOS (formerly GEOB) 207, and ' +
        'counts only those psychology courses numbered 60 to 89 in the last two digits. ' +
        'PSYC 260 counts, PSYC 305 does not. Science One (SCIE 001) is credited with 3 ' +
        'credits in each of Mathematics, Chemistry, Physics and Life Science on its own. ' +
        'Courses may be at any level.',
      sourceUrl: BREADTH,
      confidence: 'stated',
    },
    {
      id: 'sci.breadth.combined',
      kind: 'note',
      label: 'Combined specializations need 5 of 7 categories, not 6',
      detail:
        'The rule above is the major and honours figure. A combined major or combined ' +
        'honours needs 3 credits from any 5 of the 7. Either way, failing to satisfy all ' +
        'but one of your required categories before 108 attempted credits means being ' +
        'required to withdraw from the Faculty of Science.',
      sourceUrl: BREADTH,
      confidence: 'stated',
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
        'Science credit is not simply "any Faculty of Science course". Of the Geography ' +
        'courses only GEOS (formerly GEOB) carries it. In psychology it is PSYC 348 and ' +
        '448 plus every undergraduate course numbered 60 to 89 in the last two digits. ' +
        'From Land and Food Systems only FNH 350, 351, 450 and 451. From Medicine, all ' +
        'BIOC, CAPS and PCTH courses, and MEDG 410 to 421. Shown rather than counted ' +
        'because that list crosses faculties in ways a subject pattern cannot follow.',
      sourceUrl: SCIARTS,
      constraint: true,
      confidence: 'stated',
    },
    {
      id: 'sci.arts-detail',
      kind: 'note',
      label: 'What counts toward the 12 Arts credits',
      detail:
        'GEOS courses and the psychology courses that carry science credit are excluded. ' +
        'ASIC 200 and ASIC 220, jointly offered by Science and Arts, are applied as Arts ' +
        'credit. All MUSC courses in music history, theory, ethnomusicology or ' +
        'composition count, plus a maximum of 8 credits of ensemble performance. And an ' +
        'Arts course used for the Communication Requirement may not also be counted here.',
      sourceUrl: SCIARTS,
      confidence: 'stated',
    },
    {
      id: 'sci.non-science-cap',
      kind: 'note',
      label: 'At most 24 credits outside Science or Arts',
      detail:
        'A cap on where credits may come from rather than a requirement to satisfy. ' +
        'The solver does not place against it; it is shown so a student planning ' +
        'many outside electives is aware of the ceiling. Normally no more than 6 ' +
        'credits numbered 500 or above may count either, and that needs written ' +
        'permission from the instructor, your specialization advisor, the Dean of ' +
        'Science and Graduate and Postdoctoral Studies. The degree itself must be ' +
        'finished within 180 attempted credits, transfer credit included.',
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
