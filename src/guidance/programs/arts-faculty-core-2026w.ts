import type { Program, Rule } from '@/guidance/rules';

const SOURCE =
  'https://vancouver.calendar.ubc.ca/faculties-colleges-and-schools/faculty-arts/bachelor-arts/degree-requirements-students-who-enter-program-202425-or-later';
const CREDIT =
  'https://vancouver.calendar.ubc.ca/faculties-colleges-and-schools/faculty-arts/bachelor-arts/credit-requirements-and-regulations';

/**
 * The four Ways of Knowing breadth areas and the course codes in each.
 *
 * Unlike the Science Breadth categories, these lists are the Calendar's own -
 * it prints them verbatim, so they are `stated` rather than `inferred`. They
 * are carried as notes because the rule that uses them cannot be evaluated:
 * see the comment on the breadth slots below.
 */
const AREAS: [string, string, string][] = [
  [
    'humanities',
    'Humanities and Creative Arts',
    'ACAM, AFST, AMNE, ARTH, ASIA, ASIX, CDST, CENS, CINE, CRWR, CSIS, ENGL*, FIPR, ' +
      'FNIS, GMST, GRSJ, HIST, ITST, JRNL, LAST, MDIA, MDVL, MES, MUSC, NORD, PHIL, ' +
      'RGST, RMST, SCAN, SLAV, THFL, THTR, VISA, WRDS*. (*ENGL and WRDS count here ' +
      'except for the course used for the Writing Component.) Arts One (ARTS 001) ' +
      'fills up to 9 credits of this area on its own.',
  ],
  [
    'language',
    'Language as Meaning',
    'ARBC, ARBM, ASL, ASLA, CHIN, CNTO, CTLN, DANI, FNEL, FREN, GERN, GREK, HEBR, ' +
      'HINU, INDO, ITAL, JAPN, KORN, LATN, NEPL, PERS, POLS, PORT, PUNJ, RUSS, SANS, ' +
      'SEAL, SOAL, SPAN, SWAH, SWED, TIBT, UKRN, YDSH.',
  ],
  [
    'sciences',
    'Natural and Physical Sciences',
    'ASTR, ATSC, BIOC, BIOL, BIOT, CAPS, CHEM, COGS, CPSC, DSCI, ENPH, ENVR, EOSC, ' +
      'FSCT, GEOS, ISCI, MRNE, MATH, MICB, NSCI, PCTH, PHYS, STAT.',
  ],
  [
    'social',
    'Social and Behavioural Systems',
    'ANTH, ARCL, ECON, ENST, FMST, GEOG, INFO, LASO, LING, POLI, PPGA, PSYC, SOCI, ' +
      'SOWK, URST.',
  ],
];

/**
 * One of the three Ways of Knowing breadth buckets.
 *
 * A plain slot, not a pattern: which area each bucket draws from depends on
 * the student's major, which covers one of the four areas outright. Naming
 * subjects here would name the wrong ones for most majors.
 */
const breadth = (id: string, n: number, rank: string, year: number): Rule => ({
  id,
  kind: 'credits',
  label: `Ways of Knowing: ${n} credits in a single course code (${rank} area)`,
  n,
  from: { kind: 'codes', codes: [] },
  sourceUrl: SOURCE,
  constraint: true, // spent from electives, not added to them
  confidence: 'stated',
  year,
});

/**
 * Requirements every Faculty of Arts B.A. carries, regardless of major.
 *
 * The Arts core is far less plannable than the Science one, and that is the
 * Calendar's doing rather than a thin transcription. Of the five requirements
 * it lists, only the Writing Component names actual courses. The rest are
 * either constraints on how the other 120 credits are spent (Outside,
 * Upper-level, Arts Credit Minimum) or requirements whose course list lives
 * with the major rather than the Faculty (the Research Component).
 *
 * Where Science publishes a year-by-year table for every major, Arts publishes
 * none at any level. The years below are therefore ours: the Writing Component
 * is year 1 because the Calendar requires it before Year 3 standing, and the
 * breadth credits are spread across years 1 and 2 so they do not stack into
 * one term. Both are marked `stated` on the requirement and inferred only in
 * their placement, which the solver may move later anyway.
 */
export const artsFacultyCore2026W: Program = {
  code: 'arts-faculty-core-2026w',
  name: 'Faculty of Arts: general B.A. requirements',
  degree: 'BA',
  faculty: 'Arts',
  catalogYear: '2026W',
  extends: [],
  sourceUrl: SOURCE,
  totalCredits: 120,
  rules: [
    {
      id: 'arts.writing',
      kind: 'group',
      label: 'Writing and Research: Writing Component',
      year: 1,
      sourceUrl: SOURCE,
      items: [
        {
          // "students must successfully complete 3 credits of instruction on
          // research and writing in the disciplines through one of the
          // following courses". Restricted here to the 3-credit options: the
          // Calendar's list also admits Arts One and the CAP seminar, but
          // those are 18 and 6 credits and satisfy far more than this rule.
          // Putting them in the same choice would have the plan reserve 18
          // credits for a 3-credit requirement.
          id: 'arts.writing.course',
          kind: 'chooseN',
          label: 'One of WRDS 150, 151, 350, ENGL 100, ASTU 101, CAP 100',
          n: 1,
          sourceUrl: SOURCE,
          confidence: 'stated',
          of: ['WRDS 150', 'WRDS 151', 'WRDS 350', 'ENGL 100', 'ASTU 101', 'CAP 100'].map(
            (code) => ({
              id: `arts.writing.course.${code.replace(' ', '')}`,
              kind: 'course' as const,
              label: code,
              code,
            }),
          ),
        },
        {
          id: 'arts.writing.programs',
          kind: 'note',
          label: 'Arts One and the Coordinated Arts Program also satisfy this',
          detail:
            'Arts One (ARTS 001, 18 credits) and the CAP seminar (ASTU 100, 6 credits) ' +
            'both satisfy the Writing Component, but as part of a much larger first-year ' +
            'program. They are shown here rather than planned, because reserving 18 ' +
            'credits for a 3-credit requirement would distort the rest of the year. ' +
            'Arts One additionally fills up to 9 credits of Humanities and Creative Arts ' +
            'breadth.',
          sourceUrl: SOURCE,
          confidence: 'stated',
        },
        {
          id: 'arts.writing.deadline',
          kind: 'note',
          label: 'Must be complete before Year 3 standing',
          detail:
            'Students admitted from secondary school should attempt it in their first 30 ' +
            'credits and must complete it before reaching 54 credits. Transfer students ' +
            'must attempt it in their first Winter Session. Registration may be ' +
            'restricted until it is done.',
          sourceUrl: SOURCE,
          confidence: 'stated',
        },
      ],
    },
    {
      id: 'arts.research',
      kind: 'note',
      label: 'Writing and Research: Research Component',
      detail:
        'A research-intensive course named by your major, normally at the 400 level and ' +
        'often restricted to majors in the discipline. The Calendar gives a different ' +
        'approved list for each major, so it is carried by the major rather than here. ' +
        'a major that names one places it directly.',
      sourceUrl: SOURCE,
      confidence: 'stated',
    },
    {
      id: 'arts.wok',
      kind: 'group',
      label: 'Ways of Knowing Breadth: 18 credits across three areas',
      sourceUrl: SOURCE,
      items: [
        // "Students will take 9 credits in one discipline (i.e., a single
        // course code assigned to one of the three remaining Areas of
        // Breadth); 6 credits in a single course code from another Area of
        // Breadth, and 3 credits in the remaining one."
        //
        // Two halves of this cannot be expressed in the rule language: that
        // all credits in a bucket share one course code, and that the area
        // covered by the student's own major is excluded. Both are carried in
        // the labels and the notes below instead of being enforced, so the
        // plan reserves the right 18 credits without naming subjects it
        // cannot know are right.
        breadth('arts.wok.nine', 9, 'first', 1),
        breadth('arts.wok.six', 6, 'second', 2),
        breadth('arts.wok.three', 3, 'third', 2),
        {
          id: 'arts.wok.major-area',
          kind: 'note',
          label: 'Your major covers one of the four areas already',
          detail:
            'The Calendar asks for coursework across four areas, but a major or Honours ' +
            'program is deep engagement in one of them, so no further credits are needed ' +
            'there. The 18 credits above are the three remaining areas. All credits ' +
            'within one area must come from a single course code, so 9 credits of one ' +
            'subject, not 3 each of three.',
          sourceUrl: SOURCE,
          confidence: 'stated',
        },
        ...AREAS.map(([id, label, codes]): Rule => ({
          id: `arts.wok.${id}`,
          kind: 'note',
          label,
          detail: codes,
          sourceUrl: SOURCE,
          confidence: 'stated',
        })),
      ],
    },
    {
      id: 'arts.place-power',
      kind: 'note',
      label: 'Place and Power: 3 credits',
      detail:
        'Three credits from the approved Place and Power list, taken at UBC Vancouver ' +
        '(transfer credit in the same subject and number does not count). The Calendar ' +
        'says these credits "do not need to be exclusive of the student’s other degree ' +
        'or program requirements" and may sit inside the breadth credits above or inside ' +
        'the major, so charging them separately would double-count. Shown rather than ' +
        'planned for that reason, but you do still have to pick one.',
      sourceUrl: SOURCE,
      constraint: true,
      confidence: 'stated',
    },
    {
      // "A minimum of 72 of the 120 credits required for the Bachelor of Arts
      // degree program must be Arts credit."
      //
      // Written first as a 72-credit `credits` rule, by analogy with the
      // Science core's 12-credit Arts requirement. That was wrong at this
      // size. A credits bucket only counts down when the solver slots FOR it;
      // courses placed for another rule never decrement it. Twelve credits of
      // Arts inside a B.Sc. is fine that way, because nothing else in a
      // science degree was going to satisfy it anyway - but a B.A. major
      // delivers 42 Arts credits on its own, and the rule could not see them.
      // It scheduled all 72 on top, overran the 75-credit elective pool, and
      // pushed a 120-credit degree to 141 across ten terms.
      //
      // It is a constraint on where the other credits go, which is what the
      // notes below are for.
      id: 'arts.arts-minimum',
      kind: 'note',
      label: 'At least 72 credits in Arts',
      detail:
        'Arts credit is defined by subject area: anything the Calendar lists as offered ' +
        'by the Faculty of Arts, including transfer credit in those subjects. Your major ' +
        'supplies roughly 42 of the 72 on its own, so what this really asks is that most ' +
        'of your electives stay inside Arts. Relaxed only if your specialization itself ' +
        'requires more than 48 credits outside Arts.',
      sourceUrl: SOURCE,
      constraint: true,
      confidence: 'stated',
    },
    {
      id: 'arts.outside',
      kind: 'note',
      label: 'Outside Requirement: 60 credits outside your specialization',
      detail:
        'For a single Major, 60 of the 120 credits must fall outside the field of study ' +
        'of the specialization; 48 for Honours or a Combined Major, 24 for a Double ' +
        'Major or when a Minor is added. Every course accepted towards a specialization ' +
        'counts as inside it, even when taken as an elective. Cognitive Systems and ' +
        'Interdisciplinary Studies are exempt.',
      sourceUrl: SOURCE,
      constraint: true,
      confidence: 'stated',
    },
    {
      id: 'arts.upper-level',
      kind: 'note',
      label: 'Upper-level: 48 credits at 300 or above',
      detail:
        '48 for a Major, Combined Major or Interdisciplinary Studies; 54 for Honours, ' +
        '60 for a Double Major, 66 for a Major/Honours and 84 for Double Honours. ' +
        'Adding a Minor does not raise it. These are 48 of the degree’s 120 credits ' +
        'spent at the upper level, not 48 on top, so they are shown rather than placed.',
      sourceUrl: SOURCE,
      constraint: true,
      confidence: 'stated',
    },
    {
      id: 'arts.non-arts-cap',
      kind: 'note',
      label: 'At most 48 credits from outside Arts',
      detail:
        'Relaxed for majors that require more than 48 outside credits, Mathematics and ' +
        'Computer Science among them, but a student granted the relaxation must then ' +
        'take the maximum Arts credits the degree allows, with no non-Arts elective ' +
        'credit permitted. Also capped: 60 transfer credits, and 9 credits at the 500 level.',
      sourceUrl: CREDIT,
      confidence: 'stated',
    },
    {
      id: 'arts.residency',
      kind: 'note',
      label: 'Residency: 50% of degree, upper-level and specialization credits',
      detail:
        'A minimum of 50% of total degree credits, 50% of upper-level degree credits, ' +
        'and 50% of upper-level specialization credits must be completed while ' +
        'registered in the Faculty of Arts. Depends on transfer history rather than ' +
        'course selection, so it is shown, not planned.',
      sourceUrl: CREDIT,
      confidence: 'stated',
    },
    {
      id: 'arts.music-exclusion',
      kind: 'note',
      label: 'Not all MUSC credit counts toward a B.A.',
      detail:
        'Music history, theory, technology, ethnomusicology and composition are all ' +
        'acceptable, but a maximum of 12 credits of ensemble performance may be applied, ' +
        'and individual lessons, aural skills, conducting and repertoire courses are not ' +
        'applicable at all. Arts Co-op Search and Work Term credit does not count either.',
      sourceUrl: CREDIT,
      confidence: 'stated',
    },
  ],
};
