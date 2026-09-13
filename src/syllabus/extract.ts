import Anthropic from '@anthropic-ai/sdk';
import { ASSESSMENT_TOOL, normalizeAssessments, type ExtractedAssessment } from './schema';
import { MAX_SYLLABUS_TEXT_CHARS } from './validate';

const client = new Anthropic();

const SYSTEM = `You read UBC course syllabi and list every graded assessment.
Report only what the syllabus actually states. If a date is not given, leave it
null - do not infer one from the term calendar. Every assessment must include a
verbatim quote from the syllabus and the page it appears on. If the syllabus
was pasted as plain text it has no pages, so report page 1 for every row.`;

/**
 * `source` is the uploaded PDF's bytes, or the syllabus pasted as plain text
 * for a course whose syllabus is not downloadable. One branch, one model call:
 * the tool, the strict schema, the effort and the forced tool_choice are the
 * same either way, so the two sources cannot drift apart.
 */
export async function extractAssessments(source: Buffer | string): Promise<ExtractedAssessment[]> {
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
    system: SYSTEM,
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
  return call ? normalizeAssessments(call.input) : [];
}
