import * as cheerio from 'cheerio';

const clean = (s: string) => s.replace(/\s+/g, ' ').trim();
const orNull = (s: string) => (s.length ? s : null);

/**
 * Splits a course body into description / prerequisite / corequisite.
 * Prereq and coreq clauses run to the end of the text or to the start of the
 * next labelled clause — never to the first period, which appears inside them.
 */
export function parseBody(html: string | null): {
  description: string | null;
  prereqText: string | null;
  coreqText: string | null;
} {
  if (!html) return { description: null, prereqText: null, coreqText: null };

  const text = clean(cheerio.load(html).root().text());

  const label = /\b(Prerequisite|Corequisite|Pre-req|Co-req)s?\s*:/gi;
  const marks: { name: string; start: number; bodyStart: number }[] = [];
  for (const m of text.matchAll(label)) {
    // A label only counts as a clause boundary at the start of a sentence —
    // mid-sentence mentions ("...take one of the following as a corequisite:
    // BIOL 234") are prose, not a new clause, so they must be rejected here
    // or the real clause gets truncated / its codes silently dropped.
    const before = text.slice(0, m.index!).trimEnd();
    if (before.length > 0 && !/[.!?\]]$/.test(before)) continue;
    marks.push({
      name: m[1].toLowerCase().startsWith('pre') ? 'prereq' : 'coreq',
      start: m.index!,
      bodyStart: m.index! + m[0].length,
    });
  }

  const sliceTo = (i: number) => (i + 1 < marks.length ? marks[i + 1].start : text.length);

  let prereqText: string | null = null;
  let coreqText: string | null = null;
  marks.forEach((mark, i) => {
    const value = orNull(clean(text.slice(mark.bodyStart, sliceTo(i))));
    if (mark.name === 'prereq') prereqText ??= value;
    else coreqText ??= value;
  });

  const descriptionEnd = marks.length ? marks[0].start : text.length;
  const description = orNull(
    clean(text.slice(0, descriptionEnd).replace(/\[\d+-\d+-\d+\]/g, '')),
  );

  return { description, prereqText, coreqText };
}
