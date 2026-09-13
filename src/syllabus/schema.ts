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
  required: ['title', 'kind', 'date', 'startTime', 'weight', 'quote', 'page'],
  properties: {
    title: { type: 'string', description: 'As the syllabus names it, e.g. "Midterm 1".' },
    kind: { type: 'string', enum: [...ASSESSMENT_KINDS] },
    date: {
      type: ['string', 'null'],
      description: 'ISO date (YYYY-MM-DD), or null if the syllabus gives none. Never infer one.',
    },
    startTime: { type: ['string', 'null'], description: '24-hour HH:MM, or null.' },
    weight: { type: ['number', 'null'], description: 'Percent of the final grade, or null.' },
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
  const location = typeof r?.location === 'string' && r.location.trim() !== ''
    ? r.location.trim().slice(0, 120)
    : null;
  return { ...row, location };
}
