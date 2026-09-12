import type Anthropic from '@anthropic-ai/sdk';

export const ASSESSMENT_KINDS = ['midterm', 'final', 'assignment', 'quiz'] as const;
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
 * Defensive on purpose: a row that cannot be checked is not offered. Every
 * saved assessment is shown to a student beside its quote, so a row with no
 * quote has nothing to verify against and is dropped rather than displayed.
 */
export function normalizeAssessments(input: unknown): ExtractedAssessment[] {
  const list = (input as { assessments?: unknown })?.assessments;
  if (!Array.isArray(list)) return [];

  const out: ExtractedAssessment[] = [];
  for (const raw of list) {
    const r = raw as Record<string, unknown>;
    if (typeof r?.title !== 'string' || r.title.trim() === '') continue;
    if (!ASSESSMENT_KINDS.includes(r.kind as AssessmentKind)) continue;
    if (typeof r.quote !== 'string' || r.quote.trim() === '') continue;
    if (!Number.isInteger(r.page)) continue;

    out.push({
      title: r.title.trim(),
      kind: r.kind as AssessmentKind,
      date: typeof r.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.date) ? r.date : null,
      startTime: typeof r.startTime === 'string' && /^\d{2}:\d{2}$/.test(r.startTime)
        ? r.startTime : null,
      weight: typeof r.weight === 'number' && Number.isFinite(r.weight) ? r.weight : null,
      quote: r.quote.trim(),
      page: r.page as number,
    });
  }
  return out;
}
