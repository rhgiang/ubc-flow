import type { Program, Rule } from '@/guidance/rules';

const SOURCE =
  'https://vancouver.calendar.ubc.ca/faculties-colleges-and-schools/faculty-arts/bachelor-arts/history';

const CAPSTONE = ['HIST 403', 'HIST 466', 'HIST 468', 'HIST 490'];

const upper = (id: string, n: number, year: number): Rule => ({
  id,
  kind: 'credits',
  label: 'Further HIST at the 300 or 400 level',
  n,
  year,
  from: {
    kind: 'pattern', subjects: ['HIST'], levelMin: 300, levelMax: 499, exclude: CAPSTONE,
  },
  sourceUrl: SOURCE,
  confidence: 'stated',
});

/**
 * Major in History (B.A.), 2026W — 42 credits toward a 120-credit degree.
 *
 * The least prescriptive Arts major transcribed so far: 12 credits at the 100
 * and 200 level with at least 6 at the 200 level, and 30 above it. Only one
 * course is actually named, the capstone, and even that is a choice of four.
 *
 * The pre-modern requirement is real but unplannable — the Calendar says the
 * list of courses with substantial pre-modern content lives with departmental
 * advisors and on the department website, not in the Calendar. It is reserved
 * as 6 credits of upper-level History and described in a note, so the credits
 * are right even though the course set cannot be.
 */
export const histMajor2026W: Program = {
  code: 'hist-major-ba-2026w',
  name: 'History Major',
  degree: 'BA',
  faculty: 'Arts',
  catalogYear: '2026W',
  extends: ['arts-faculty-core-2026w'],
  sourceUrl: SOURCE,
  totalCredits: 120,
  rules: [
    {
      id: 'hist.lower',
      kind: 'group',
      label: 'Lower-level requirements — 12 credits at the 100 and 200 level',
      sourceUrl: SOURCE,
      items: [
        {
          id: 'hist.lower.100',
          kind: 'credits',
          label: 'HIST at the 100 or 200 level',
          n: 6,
          year: 1,
          from: { kind: 'pattern', subjects: ['HIST'], levelMin: 100, levelMax: 299 },
          sourceUrl: SOURCE,
          confidence: 'stated',
        },
        {
          // "At least 6 of these credits must be at the 200 level."
          id: 'hist.lower.200',
          kind: 'credits',
          label: 'HIST at the 200 level',
          n: 6,
          year: 2,
          from: { kind: 'pattern', subjects: ['HIST'], levelMin: 200, levelMax: 299 },
          sourceUrl: SOURCE,
          confidence: 'stated',
        },
      ],
    },
    {
      id: 'hist.upper',
      kind: 'group',
      label: 'Upper-level requirements — 30 credits at 300 or above',
      year: 3,
      sourceUrl: SOURCE,
      items: [
        {
          id: 'hist.premodern',
          kind: 'credits',
          label: 'Substantially pre-modern history — 6 credits',
          n: 6,
          year: 3,
          // The approved list is not in the Calendar; see the note below.
          from: {
            kind: 'pattern', subjects: ['HIST'], levelMin: 300, levelMax: 499, exclude: CAPSTONE,
          },
          sourceUrl: SOURCE,
          confidence: 'inferred',
        },
        upper('hist.upper-additional.y3', 9, 3),
        {
          // "must include 3 credits of HIST_V 403, 466, 468, or 490, to be
          // taken in the final year of study."
          id: 'hist.capstone',
          kind: 'chooseN',
          label: 'Capstone in the final year: HIST 403, 466, 468 or 490',
          n: 1,
          year: 4,
          sourceUrl: SOURCE,
          confidence: 'stated',
          of: CAPSTONE.map((code) => ({
            id: `hist.capstone.${code.replace(' ', '')}`,
            kind: 'course' as const,
            label: code,
            code,
          })),
        },
        upper('hist.upper-additional.y4', 12, 4),
      ],
    },
    {
      id: 'hist.premodern-list',
      kind: 'note',
      label: 'The pre-modern list is held by the Department, not the Calendar',
      detail:
        'Six of the 30 upper-level credits must be in substantially pre-modern history. ' +
        'The Calendar does not name the courses — the list is available from departmental ' +
        'advisors and the department website. The credits are reserved here, but any ' +
        'upper-level History course is shown against them, so check the list before ' +
        'registering.',
      sourceUrl: SOURCE,
      confidence: 'stated',
    },
    {
      id: 'hist.research-component',
      kind: 'note',
      label: 'Research Component — met by the final-year capstone',
      detail:
        'The Faculty of Arts Research Component names HIST 403, 449, 466, 467, 468, 479 ' +
        'and 490 for this major. The capstone requirement above already draws from that ' +
        'list, so it costs no additional credits. Exemption from the capstone needs the ' +
        'written permission of the Head or the Majors Advisor.',
      sourceUrl: SOURCE,
      confidence: 'stated',
    },
    {
      id: 'hist.outside',
      kind: 'note',
      label: 'Up to 6 upper-level credits may come from other departments',
      detail:
        'Subject to the approval of the Department, a maximum of 6 credits from other ' +
        'departments may count toward the Major. Not modelled — the plan takes the ' +
        'default route through History.',
      sourceUrl: SOURCE,
      confidence: 'stated',
    },
    // 42 credits of major and 3 of the Faculty's Writing Component leave 75.
    { id: 'hist.electives.y1', kind: 'credits', label: 'Electives', elective: true, n: 21, year: 1,
      from: { kind: 'codes', codes: [] }, sourceUrl: SOURCE, confidence: 'stated' },
    { id: 'hist.electives.y2', kind: 'credits', label: 'Electives', elective: true, n: 24, year: 2,
      from: { kind: 'codes', codes: [] }, sourceUrl: SOURCE, confidence: 'stated' },
    { id: 'hist.electives.y3', kind: 'credits', label: 'Electives', elective: true, n: 15, year: 3,
      from: { kind: 'codes', codes: [] }, sourceUrl: SOURCE, confidence: 'stated' },
    { id: 'hist.electives.y4', kind: 'credits', label: 'Electives', elective: true, n: 15, year: 4,
      from: { kind: 'codes', codes: [] }, sourceUrl: SOURCE, confidence: 'stated' },
  ],
};
