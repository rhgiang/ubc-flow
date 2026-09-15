import Anthropic from '@anthropic-ai/sdk';
import { ASSESSMENT_TOOL, normalizeAssessments, type ExtractedAssessment } from './schema';
import { MAX_SYLLABUS_TEXT_CHARS } from './validate';
import type { TermWindow } from '@/schedule/terms';

const client = new Anthropic();

/**
 * The term window is in here for one reason: a syllabus writes "Oct 26", not
 * "2026-10-26". The prompt used to forbid inferring a date from the term
 * calendar, which the model obeyed by returning null for nearly every row, so
 * students paid for an extraction and then typed every date in by hand.
 *
 * Completing a date the syllabus states is not inferring one. A stated month
 * and day has exactly one year that puts it inside a term we already know, so
 * resolving it is arithmetic. Inventing a date for an assessment the syllabus
 * gives no date for is still forbidden, and that rule is what the last
 * paragraph below and the `date` description in schema.ts both carry.
 */
export function systemPrompt(term: TermWindow): string {
  return `You read UBC course syllabi and list every graded assessment.
Report only what the syllabus actually states.

This syllabus is for a term that runs from ${term.start} to ${term.end}.
Syllabi almost never write the year. When one states a month and day ("Oct 26",
"Friday March 3"), resolve it to the year that puts that day inside this term
and report the full YYYY-MM-DD. That is completing a date the syllabus gave
you, not inventing one, so do it every time.

When the syllabus states no date at all for an assessment, report null. "TBA",
"Date and Location will be posted on Canvas when they are available" and
"scheduled by the registrar" are not dates. Never guess one from the term
calendar or from where the assessment sits in a list.

When one assessment is written with a different date per lecture section
("Midterm 25% In-class Oct 26 (126) Oct 27 (124)"), report one row per section,
each with that section's own date and its code in "section". When the date is
the same for the whole class, report one row with "section" null.

Every assessment must include a verbatim quote from the syllabus and the page
it appears on. If the syllabus was pasted as plain text it has no pages, so
report page 1 for every row.`;
}

/**
 * A date the model resolved to a year outside the term is suspect: the month
 * and day came off the page, the year did not.
 *
 * Kept and flagged, not clamped and not dropped. Clamping invents a date the
 * syllabus never gave. Nulling throws away a day and a month we do have and
 * puts the student back to typing, which is the failure this change exists to
 * end. The confirm screen shows it beside its verbatim quote with a warning,
 * and the date is one keystroke from correct there.
 */
function flagOutsideTerm(rows: ExtractedAssessment[], term: TermWindow): ExtractedAssessment[] {
  return rows.map((r) => (
    r.date && (r.date < term.start || r.date > term.end) ? { ...r, outsideTerm: true } : r
  ));
}

/**
 * `source` is the uploaded PDF's bytes, or the syllabus pasted as plain text
 * for a course whose syllabus is not downloadable. One branch, one model call:
 * the tool, the strict schema, the effort, the term window and the forced
 * tool_choice are the same either way, so the two sources cannot drift apart.
 */
export async function extractAssessments(
  source: Buffer | string,
  term: TermWindow,
): Promise<ExtractedAssessment[]> {
  // Last line before a paid call, and the only chokepoint both sources pass
  // through: pasted text is capped here as well as on write, so no stored row
  // can bill for more than MAX_SYLLABUS_TEXT_CHARS of input.
  if (typeof source === 'string' && source.length > MAX_SYLLABUS_TEXT_CHARS) {
    throw new Error('Syllabus text is longer than the extraction cap.');
  }

  const response = await client.messages.create({
    model: 'claude-opus-5',
    max_tokens: 16000,
    // Pulling a list out of a structured document isn't reasoning-hard -
    // default (high) thinking effort buys nothing here and output tokens at
    // $25/MTok are what actually drive the bill.
    output_config: { effort: 'low' },
    system: systemPrompt(term),
    tools: [ASSESSMENT_TOOL],
    // Force the tool call: without this a prose reply (no tool_use block)
    // silently becomes normalizeAssessments(undefined) -> [], which renders
    // as "No graded assessments found" - indistinguishable from a real empty
    // result, after the call has already been paid for.
    tool_choice: { type: 'tool', name: 'report_assessments' },
    messages: [{
      role: 'user',
      content: [
        typeof source === 'string'
          ? { type: 'text' as const, text: source }
          : {
              type: 'document' as const,
              source: {
                type: 'base64' as const,
                media_type: 'application/pdf' as const,
                data: source.toString('base64'),
              },
            },
        { type: 'text', text: 'List every graded assessment in this syllabus.' },
      ],
    }],
  });

  const call = response.content.find((b) => b.type === 'tool_use');
  return call ? flagOutsideTerm(normalizeAssessments(call.input), term) : [];
}
