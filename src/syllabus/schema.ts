import type Anthropic from '@anthropic-ai/sdk';

export const ASSESSMENT_KINDS = ['midterm', 'final', 'assignment', 'quiz'] as const;

/** The most rows one syllabus save may carry. A real syllabus lists a dozen;
 *  this is far past any honest one and keeps a scripted client from writing
 *  an unbounded table. Shared by the save route and the confirm table so the
 *  Save button can say why before the request is made. */
export const MAX_ASSESSMENT_ROWS = 100;
export type AssessmentKind = (typeof ASSESSMENT_KINDS)[number];

export type ExtractedAssessment = {
  title: string;
  kind: AssessmentKind;
  date: string | null;
  startTime: string | null;
  weight: number | null;
  /**
   * Which lecture section this row's date is for, when one line gives a
   * different date per section ("In-class Oct 26 (126) Oct 27 (124)"), and
   * null when the date is everyone's.
   *
   * A CONFIRM SCREEN HINT ONLY. There is deliberately no column for it and no
   * migration: its whole job is to let a student pick the row that is theirs
   * before anything is saved, and once they have confirmed, the surviving row
   * is simply their assessment. Storing it would mean maintaining a second,
   * staler copy of section membership that `EnrollmentMeeting` already holds.
   */
  section: string | null;
  /**
   * Set when `date` landed outside the term this syllabus belongs to. The
   * month and day came off the page but the year did not, so the row is kept
   * and shown with a warning rather than clamped (which invents a date) or
   * nulled (which is the bug this whole change exists to fix). Never stored:
   * it is recomputed from the term on each extraction.
   */
  outsideTerm?: boolean;
  quote: string;
  page: number;
};

/**
 * A row the student typed in themselves, for an assessment the extraction
 * missed or never had a syllabus sentence for. It carries no quote and no
 * page because there is nothing to quote: the student saying so IS the
 * evidence, which is exactly what a model's row can never be.
 */
export type ManualAssessment = Omit<ExtractedAssessment, 'quote' | 'page'> & {
  quote: null;
  page: null;
};

/** Either origin, as the confirm screen saves them. */
export type SavedAssessment = ExtractedAssessment | ManualAssessment;

/** One saved row on its way back out to the editor. `kind` is a plain String
 *  column, narrowed here because the save route is its only writer. */
export type SavedAssessmentRow = SavedAssessment & { editedByUser: boolean };

const assessment = {
  type: 'object',
  additionalProperties: false,
  // strict:true: every property is listed in `required` and nullable ones are
  // typed ["string","null"], or the API rejects the tool definition outright.
  required: ['title', 'kind', 'date', 'startTime', 'weight', 'section', 'quote', 'page'],
  properties: {
    title: { type: 'string', description: 'As the syllabus names it, e.g. "Midterm 1".' },
    kind: { type: 'string', enum: [...ASSESSMENT_KINDS] },
    date: {
      type: ['string', 'null'],
      description: 'The date the syllabus states, as YYYY-MM-DD. Syllabi rarely write the '
        + 'year, so when one gives a month and day ("Oct 26"), resolve it to the year that '
        + 'puts it inside the term stated in the system prompt and report the full date. '
        + 'Null when the syllabus states no date for this assessment at all: "TBA", "will '
        + 'be posted on Canvas" and "scheduled by the registrar" are not dates, and a date '
        + 'is never guessed from the term calendar or from a position in a list.',
    },
    startTime: { type: ['string', 'null'], description: '24-hour HH:MM, or null.' },
    weight: { type: ['number', 'null'], description: 'Percent of the final grade, or null.' },
    section: {
      type: ['string', 'null'],
      description: 'The lecture section this date is for, exactly as the syllabus writes it '
        + '("126"), when one assessment is written with a different date per section. One row '
        + 'per section in that case, each with its own date. Null when the date is the same '
        + 'for the whole class, which is the usual case.',
    },
    quote: { type: 'string', description: 'Verbatim sentence from the syllabus supporting this row.' },
    page: { type: 'integer', description: '1-indexed page the quote appears on.' },
  },
} as const;

export const ASSESSMENT_TOOL: Anthropic.Tool = {
  name: 'report_assessments',
  description: 'Report every graded assessment stated in the syllabus.',
  strict: true,
  input_schema: {
    type: 'object',
    additionalProperties: false,
    required: ['assessments'],
    properties: { assessments: { type: 'array', items: assessment } },
  },
};

/**
 * The rules that hold for every row whatever wrote it: a real title, and a
 * `kind` this app knows. Neither origin is exempt, so neither gets its own
 * copy of these.
 */
function normalizeFields(raw: unknown): Omit<ExtractedAssessment, 'quote' | 'page'> | null {
  const r = raw as Record<string, unknown>;
  if (typeof r?.title !== 'string' || r.title.trim() === '') return null;
  if (!ASSESSMENT_KINDS.includes(r.kind as AssessmentKind)) return null;

  return {
    title: r.title.trim(),
    kind: r.kind as AssessmentKind,
    date: typeof r.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.date) ? r.date : null,
    startTime: typeof r.startTime === 'string' && /^\d{2}:\d{2}$/.test(r.startTime)
      ? r.startTime : null,
    weight: typeof r.weight === 'number' && Number.isFinite(r.weight) ? r.weight : null,
    // Capped because it is rendered: a section code is three or four
    // characters, and this one comes off a PDF a stranger wrote.
    section: typeof r.section === 'string' && r.section.trim() !== ''
      ? r.section.trim().slice(0, 20) : null,
  };
}

/**
 * Model output. Defensive on purpose: a row that cannot be checked is not
 * offered. Every extracted assessment is shown to a student beside its quote,
 * so a row with no quote has nothing to verify against and is dropped rather
 * than displayed. That rule is about the MODEL, not about the student, and it
 * does not loosen: see normalizeSavedAssessment for the other origin.
 */
export function normalizeAssessments(input: unknown): ExtractedAssessment[] {
  const list = (input as { assessments?: unknown })?.assessments;
  if (!Array.isArray(list)) return [];

  const out: ExtractedAssessment[] = [];
  for (const raw of list) {
    const base = normalizeFields(raw);
    if (!base) continue;
    const r = raw as Record<string, unknown>;
    if (typeof r.quote !== 'string' || r.quote.trim() === '') continue;
    if (!Number.isInteger(r.page) || (r.page as number) <= 0) continue;

    out.push({ ...base, quote: r.quote.trim(), page: r.page as number });
  }
  return out;
}

/**
 * A stored row on its way back out to the editor: `date` as the YYYY-MM-DD
 * an <input type="date"> wants, and the evidence pair only when BOTH halves
 * are there, since a quote nobody can find a page for cites nothing. `kind`
 * is checked here too - it is a plain String column, and a row the editor
 * cannot represent is not one to hand it.
 */
export function toSavedAssessmentRow(row: {
  title: string;
  kind: string;
  date: Date | null;
  startTime: string | null;
  weight: number | null;
  quote: string | null;
  page: number | null;
  editedByUser: boolean;
}): SavedAssessmentRow | null {
  if (!ASSESSMENT_KINDS.includes(row.kind as AssessmentKind)) return null;
  const base = {
    title: row.title,
    kind: row.kind as AssessmentKind,
    date: row.date ? row.date.toISOString().slice(0, 10) : null,
    startTime: row.startTime,
    weight: row.weight,
    // Always null coming back out: `section` is the confirm screen's way of
    // asking "which of these is yours", and a saved row is the one the
    // student already answered that with.
    section: null,
    editedByUser: row.editedByUser,
  };
  return row.quote !== null && row.page !== null
    ? { ...base, quote: row.quote, page: row.page }
    : { ...base, quote: null, page: null };
}

/**
 * One row off the confirm screen's Save, of either origin.
 *
 * `manual: true` is the student saying "I typed this one", and only then is a
 * null quote allowed: the evidence for a hand-entered row is the student who
 * entered it. Everything else is treated as model output and still has to
 * carry the verbatim quote and page a human can check the PDF against, so
 * re-saving an extracted list cannot quietly strip its evidence.
 *
 * `editedByUser` is settled here rather than at the call site, because origin
 * is what decides it: a hand-typed row is the student's work whatever the
 * client flagged, and an untouched extracted row is not.
 */
export function normalizeSavedAssessment(raw: unknown): SavedAssessmentRow | null {
  const r = raw as Record<string, unknown>;
  if (r?.manual !== true) {
    const extracted = normalizeAssessments({ assessments: [raw] })[0];
    return extracted ? { ...extracted, editedByUser: r?.edited === true } : null;
  }
  const base = normalizeFields(raw);
  return base ? { ...base, quote: null, page: null, editedByUser: true } : null;
}

/** What an exam added from the exam view is called, when the student named no
 *  title: the form asks for a kind, not a name. */
function examTitle(kind: unknown): string {
  return kind === 'final' ? 'Final exam' : 'Midterm';
}

/** A room the student typed, from either the add form or the detail overlay's
 *  edit. Capped because it is rendered; blank means "no location", which is
 *  how a student clears one they got wrong. */
export function normalizeExamLocation(raw: unknown): string | null {
  return typeof raw === 'string' && raw.trim() !== '' ? raw.trim().slice(0, 120) : null;
}

/**
 * One exam typed straight into the exam view. The manual path through
 * `normalizeSavedAssessment` - no quote, no page, `editedByUser` true, because
 * the student is the evidence - narrowed to the two kinds that belong on an
 * exam page, and titled from the kind since that form asks for no name.
 *
 * `location` is this origin's alone: an extraction never reports one.
 */
export function normalizeManualExam(raw: unknown): (SavedAssessmentRow & { location: string | null }) | null {
  const r = raw as Record<string, unknown>;
  const row = normalizeSavedAssessment({ ...r, manual: true, title: examTitle(r?.kind) });
  if (!row || (row.kind !== 'midterm' && row.kind !== 'final')) return null;
  return { ...row, location: normalizeExamLocation(r?.location) };
}
