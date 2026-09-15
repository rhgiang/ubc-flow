import { describe, it, expect, vi } from 'vitest';
import { normalizeAssessments, ASSESSMENT_TOOL } from '@/syllabus/schema';
import { termDateRange } from '@/schedule/terms';

const recorded = {
  assessments: [
    { title: 'Midterm 1', kind: 'midterm', date: '2026-10-14', startTime: '18:00',
      weight: 20, section: null, quote: 'Midterm 1: Tuesday October 14, 6:00pm (20%)', page: 3 },
    { title: 'Final Exam', kind: 'final', date: null, startTime: null,
      weight: 45, section: null, quote: 'Final exam (45%), scheduled by the registrar', page: 3 },
  ],
};

describe('ASSESSMENT_TOOL', () => {
  // strict:true requires both, or the API rejects the tool definition.
  it('is strict and closed', () => {
    expect(ASSESSMENT_TOOL.strict).toBe(true);
    const schema = ASSESSMENT_TOOL.input_schema as Record<string, unknown>;
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toContain('assessments');
  });

  // Adding a property without adding it to `required` is a 400 from the API,
  // which would land as "could not read this syllabus" with no clue why.
  it('lists every property in required, section included', () => {
    const item = (ASSESSMENT_TOOL.input_schema as {
      properties: { assessments: { items: { required: string[]; properties: object } } };
    }).properties.assessments.items;
    expect([...item.required].sort()).toEqual(Object.keys(item.properties).sort());
    expect(item.required).toContain('section');
  });
});

describe('normalizeAssessments', () => {
  it('parses recorded tool input', () => {
    const out = normalizeAssessments(recorded);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ title: 'Midterm 1', kind: 'midterm', weight: 20, page: 3 });
  });

  it('keeps an undated final rather than dropping it', () => {
    expect(normalizeAssessments(recorded)[1].date).toBeNull();
  });

  it('drops a row with an unknown kind instead of guessing', () => {
    const out = normalizeAssessments({
      assessments: [{ ...recorded.assessments[0], kind: 'participation' }],
    });
    expect(out).toEqual([]);
  });

  // Every saved row is shown to a student beside its quote; a row without one
  // cannot be checked, so it is not offered.
  it('drops a row with no quote', () => {
    const out = normalizeAssessments({
      assessments: [{ ...recorded.assessments[0], quote: '' }],
    });
    expect(out).toEqual([]);
  });

  it('returns empty for malformed input rather than throwing', () => {
    expect(normalizeAssessments(null)).toEqual([]);
    expect(normalizeAssessments({ assessments: 'nope' })).toEqual([]);
  });

  // The backstop stays: the fix for empty dates is upstream, in the prompt.
  it('nulls a date that is not YYYY-MM-DD rather than passing it on', () => {
    const out = normalizeAssessments({
      assessments: [{ ...recorded.assessments[0], date: 'Oct 26' }],
    });
    expect(out[0].date).toBeNull();
  });

  it('carries the section through and nulls a blank one', () => {
    const out = normalizeAssessments({
      assessments: [
        { ...recorded.assessments[0], section: ' 126 ' },
        { ...recorded.assessments[0], section: '  ' },
      ],
    });
    expect(out[0].section).toBe('126');
    expect(out[1].section).toBeNull();
  });
});

describe('termDateRange', () => {
  // Term.startDate/endDate are NULL on every row in this dataset (the
  // catalogue scrape reads a term picker that publishes a name only), so the
  // session months have to carry this or nothing resolves.
  it('falls back to the session months when the columns are empty', () => {
    const w = { startDate: null, endDate: null };
    expect(termDateRange({ year: 2026, session: 'W', termNumber: 1, ...w }))
      .toEqual({ start: '2026-09-01', end: '2026-12-31' });
    // Term.year is the academic year a term STARTS in: Winter T2 is Jan-Apr
    // of the following calendar year, which is the year "March 3" resolves to.
    expect(termDateRange({ year: 2026, session: 'W', termNumber: 2, ...w }))
      .toEqual({ start: '2027-01-01', end: '2027-04-30' });
    expect(termDateRange({ year: 2026, session: 'S', termNumber: null, ...w }))
      .toEqual({ start: '2026-05-01', end: '2026-08-31' });
  });

  it('runs to the end of the last month, so a December final is in term', () => {
    const range = termDateRange({
      year: 2026, session: 'W', termNumber: 1, startDate: null, endDate: null,
    });
    expect('2026-12-18' <= range.end).toBe(true);
  });

  it('only ever widens when the columns are populated', () => {
    // Real dates inside the session months change nothing: they describe the
    // teaching period, which stops before the registrar's exam period.
    expect(termDateRange({
      year: 2026, session: 'W', termNumber: 1,
      startDate: new Date('2026-09-08T00:00:00Z'), endDate: new Date('2026-12-05T00:00:00Z'),
    })).toEqual({ start: '2026-09-01', end: '2026-12-31' });
    // Dates outside them do widen it.
    expect(termDateRange({
      year: 2026, session: 'W', termNumber: 1,
      startDate: new Date('2026-08-24T00:00:00Z'), endDate: new Date('2027-01-06T00:00:00Z'),
    })).toEqual({ start: '2026-08-24', end: '2027-01-06' });
  });
});

// The whole extraction path, driven by a RECORDED tool_use response. No
// network, no API key, no Anthropic call: the SDK is replaced outright.
const create = vi.fn();
vi.mock('@anthropic-ai/sdk', () => ({
  default: class { messages = { create }; },
}));
const { extractAssessments, systemPrompt } = await import('@/syllabus/extract');

const TERM = { start: '2026-09-01', end: '2026-12-31' };

function respondWith(assessments: unknown[]) {
  create.mockResolvedValueOnce({
    content: [{ type: 'tool_use', name: 'report_assessments', input: { assessments } }],
  });
}

const midterm = {
  title: 'Midterm', kind: 'midterm', startTime: null, weight: 25,
  quote: 'Midterm 25% In-class Oct 26 (126) Oct 27 (124)', page: 2,
};

describe('systemPrompt', () => {
  it('names the term and still refuses to invent a date', () => {
    const p = systemPrompt(TERM);
    expect(p).toContain('2026-09-01');
    expect(p).toContain('2026-12-31');
    expect(p).toMatch(/report null/i);
    expect(p).toMatch(/one row per section/i);
  });
});

describe('extractAssessments', () => {
  it('keeps a resolved in-term date, one row per section, each with its own', async () => {
    respondWith([
      { ...midterm, date: '2026-10-26', section: '126' },
      { ...midterm, date: '2026-10-27', section: '124' },
    ]);
    const out = await extractAssessments('syllabus text', TERM);
    expect(out.map((r) => [r.section, r.date])).toEqual([['126', '2026-10-26'], ['124', '2026-10-27']]);
    expect(out.some((r) => r.outsideTerm)).toBe(false);
  });

  it('still reports null when the syllabus states no date', async () => {
    respondWith([{
      title: 'Final Exam', kind: 'final', date: null, startTime: null, weight: 35, section: null,
      quote: 'Final Exam (Cumulative) 35% Date and Location will be posted on Canvas when they are available',
      page: 2,
    }]);
    const [row] = await extractAssessments('syllabus text', TERM);
    expect(row.date).toBeNull();
    expect(row.outsideTerm).toBeUndefined();
  });

  it('keeps a date that resolved outside the term but flags it for the student', async () => {
    respondWith([{ ...midterm, date: '2025-10-26', section: null }]);
    const [row] = await extractAssessments('syllabus text', TERM);
    // Not clamped and not dropped: the day and month are real, only the year
    // is in doubt, and the confirm screen shows it beside the quote.
    expect(row.date).toBe('2025-10-26');
    expect(row.outsideTerm).toBe(true);
  });

  it('nulls a malformed date and leaves it unflagged', async () => {
    respondWith([{ ...midterm, date: 'Oct 26', section: null }]);
    const [row] = await extractAssessments('syllabus text', TERM);
    expect(row.date).toBeNull();
    expect(row.outsideTerm).toBeUndefined();
  });

  // The request shape this model actually accepts. Every one of these is a
  // 400 if it drifts, which reaches the student as "could not read this
  // syllabus" after the quota unit is already spent.
  it('sends one shape for both sources, with the PDF as a document block first', async () => {
    respondWith([]);
    await extractAssessments(Buffer.from('%PDF-1.4'), TERM);
    const sent = create.mock.lastCall![0];
    expect(sent.model).toBe('claude-opus-5');
    expect(sent.output_config).toEqual({ effort: 'low' });
    expect(sent.tool_choice).toEqual({ type: 'tool', name: 'report_assessments' });
    expect(sent.thinking).toBeUndefined();
    expect(sent.messages).toHaveLength(1);
    expect(sent.messages[0].content[0].type).toBe('document');
    expect(sent.messages[0].content[1].type).toBe('text');

    respondWith([]);
    await extractAssessments('pasted', TERM);
    const pasted = create.mock.lastCall![0];
    expect(pasted.messages[0].content[0]).toEqual({ type: 'text', text: 'pasted' });
    expect(pasted.tools).toEqual(sent.tools);
    expect(pasted.system).toEqual(sent.system);
  });
});
