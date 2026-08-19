import * as cheerio from 'cheerio';

export type RawTerm = {
  ubcPeriodId: string;
  name: string;
  year: number;
  session: string;
  termNumber: number | null;
  campus: string;
};

export type RawSubject = {
  ubcSubjectId: string;
  name: string;
  campus: string;
};

/** "2025-26 Winter Term 1 (UBC-V)" | "2026 Summer Session (UBC-V)" */
export function parseTermOption(value: string, label: string): RawTerm {
  const text = label.trim();
  const year = Number(text.match(/^(\d{4})/)?.[1]);
  const session = /winter/i.test(text) ? 'W' : /summer/i.test(text) ? 'S' : 'U';
  const termNumber = text.match(/Term\s+(\d)/i) ? Number(text.match(/Term\s+(\d)/i)![1]) : null;
  const campus = /UBC-O/i.test(text) ? 'O' : 'V';
  return { ubcPeriodId: value, name: text, year, session, termNumber, campus };
}

/** "Computer Science (Vancouver)" */
export function parseSubjectOption(value: string, label: string): RawSubject {
  const text = label.trim();
  const campus = /okanagan/i.test(text) ? 'O' : 'V';
  const name = text.replace(/\s*\((Vancouver|Okanagan)\)\s*$/i, '').trim();
  return { ubcSubjectId: value, name, campus };
}

function options($: cheerio.CheerioAPI, selector: string) {
  return $(selector)
    .find('option')
    .toArray()
    .map((el) => ({ value: $(el).attr('value') ?? '', label: $(el).text() }))
    // "- Any -" and friends carry a non-numeric value ("All"); real rows are numeric.
    .filter((o) => /^\d+$/.test(o.value));
}

export function parseCatalogForm(html: string): { terms: RawTerm[]; subjects: RawSubject[] } {
  const $ = cheerio.load(html);
  return {
    terms: options($, '#edit-academic-period').map((o) => parseTermOption(o.value, o.label)),
    subjects: options($, '#edit-subject').map((o) => parseSubjectOption(o.value, o.label)),
  };
}
