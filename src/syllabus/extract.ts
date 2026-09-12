import Anthropic from '@anthropic-ai/sdk';
import { ASSESSMENT_TOOL, normalizeAssessments, type ExtractedAssessment } from './schema';

const client = new Anthropic();

const SYSTEM = `You read UBC course syllabi and list every graded assessment.
Report only what the syllabus actually states. If a date is not given, leave it
null — do not infer one from the term calendar. Every assessment must include a
verbatim quote from the syllabus and the page it appears on.`;

export async function extractAssessments(pdf: Buffer): Promise<ExtractedAssessment[]> {
  const response = await client.messages.create({
    model: 'claude-opus-5',
    max_tokens: 16000,
    // Pulling a list out of a structured document isn't reasoning-hard —
    // default (high) thinking effort buys nothing here and output tokens at
    // $25/MTok are what actually drive the bill.
    output_config: { effort: 'low' },
    system: SYSTEM,
    tools: [ASSESSMENT_TOOL],
    // Force the tool call: without this a prose reply (no tool_use block)
    // silently becomes normalizeAssessments(undefined) -> [], which renders
    // as "No graded assessments found" — indistinguishable from a real empty
    // result, after the call has already been paid for.
    tool_choice: { type: 'tool', name: 'report_assessments' },
    messages: [{
      role: 'user',
      content: [
        {
          type: 'document',
          source: { type: 'base64', media_type: 'application/pdf', data: pdf.toString('base64') },
        },
        { type: 'text', text: 'List every graded assessment in this syllabus.' },
      ],
    }],
  });

  const call = response.content.find((b) => b.type === 'tool_use');
  return call ? normalizeAssessments(call.input) : [];
}
