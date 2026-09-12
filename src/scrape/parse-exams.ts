import * as cheerio from 'cheerio';
import { inferTerm } from '@/upload/parse-workday';

export type ExamRow = {
  subjectCode: string;
  courseNumber: string;
  sectionCode: string;
  /** ISO date. Null only on a cancelled exam, which UBC publishes dateless. */
  date: string | null;
  /** 24-hour "HH:MM". The table gives a start only — there is no end time. */
  startTime: string | null;
  alphaSplit: string | null;
  building: string | null;
  room: string | null;
  notes: string | null;
  cancelled: boolean;
};

export type ParsedExams = {
  rows: ExamRow[];
  term: { year: number; session: string; termNumber: number | null } | null;
};

const MONTHS: Record<string, string> = {
  JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06',
  JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12',
};

/**
 * "BIOC_V 302.951" -> subject BIOC_V, number 302, section 951.
 * Splits on the FIRST dot: sections are not numeric ("FNH_V 497.B_941",
 * "AUDI_V 402.98A"), so a last-dot split or a \d+ section breaks real rows.
 */
function parseCourseCell(cell: string) {
  const m = cell.trim().match(/^(\S+)\s+([^.\s]+)\.(.+)$/);
  if (!m) return null;
  return { subjectCode: m[1], courseNumber: m[2], sectionCode: m[3].trim() };
}

/** "AUG 18 2026 12:00 PM" -> { date: "2026-08-18", startTime: "12:00" }. */
function parseDateCell(cell: string) {
  const m = cell
    .trim()
    .match(/^([A-Z]{3})\s+(\d{1,2})\s+(\d{4})\s+(\d{1,2}):(\d{2})\s*([AP])M$/i);
  if (!m) return { date: null, startTime: null };
  const month = MONTHS[m[1].toUpperCase()];
  if (!month) return { date: null, startTime: null };

  let hour = Number(m[4]) % 12;
  if (m[6].toUpperCase() === 'P') hour += 12;

  return {
    date: `${m[3]}-${month}-${m[2].padStart(2, '0')}`,
    startTime: `${String(hour).padStart(2, '0')}:${m[5]}`,
  };
}

/**
 * "BIOL 1000" -> BIOL / 1000. "SEE PROF" -> null / null.
 *
 * ponytail: the room must contain a digit rather than matching a denylist of
 * sentinels. "SEE PROF" satisfies any plain `WORD WORD` pattern, and a
 * denylist needs editing every time the registrar invents a new placeholder.
 * If a genuine all-letter room ever appears, this is the line to relax.
 */
function parseLocationCell(cell: string) {
  const m = cell.trim().match(/^([A-Z_]{2,6})\s+(\S+)$/i);
  if (!m || !/\d/.test(m[2])) return { building: null, room: null };
  return { building: m[1], room: m[2] };
}

function cellText(text: string): string | null {
  const value = text.trim();
  return value === '' ? null : value;
}

export function parseExamSchedule(html: string): ParsedExams {
  const $ = cheerio.load(html);
  const rows: ExamRow[] = [];

  $('#tablepress-1 tbody tr').each((_, tr) => {
    const cells = $(tr)
      .find('td')
      .map((_i, td) => $(td).text().trim())
      .get();
    if (cells.length < 6) return;

    // The Department column is truncated in the source ("FNH_" for "FNH_V"),
    // so the course cell is the only authority on the subject code.
    const course = parseCourseCell(cells[1]);
    if (!course) return;

    const notes = cellText(cells[5]);
    const { date, startTime } = parseDateCell(cells[2]);
    const { building, room } = parseLocationCell(cells[3]);

    rows.push({
      ...course,
      date,
      startTime,
      alphaSplit: cellText(cells[4]),
      building,
      room,
      notes,
      // One prefix test, not a note parser: anything richer starts guessing at
      // free text the registrar rewords at will.
      cancelled: /^cancelled/i.test(notes ?? ''),
    });
  });

  return { rows, term: majorityTerm(rows) };
}

/**
 * One published table covers one exam period, so the term is derived once for
 * the whole run. Per-row inference would leave every cancelled row — which has
 * no date cell at all — stranded with no term.
 */
function majorityTerm(rows: ExamRow[]): ParsedExams['term'] {
  const counts = new Map<string, { term: NonNullable<ParsedExams['term']>; n: number }>();
  for (const row of rows) {
    if (!row.date) continue;
    const term = inferTerm(row.date);
    if (!term) continue;
    const key = `${term.year}-${term.session}-${term.termNumber}`;
    const seen = counts.get(key);
    if (seen) seen.n += 1;
    else counts.set(key, { term, n: 1 });
  }
  let best: { term: NonNullable<ParsedExams['term']>; n: number } | null = null;
  for (const entry of counts.values()) {
    if (!best || entry.n > best.n) best = entry;
  }
  return best?.term ?? null;
}
