export const GRADE_BUCKETS = [
  '<50', '50-54', '55-59', '60-63', '64-67', '68-71',
  '72-75', '76-79', '80-84', '85-89', '90-100',
] as const;

export type GradeBucket = (typeof GRADE_BUCKETS)[number];

export type RawGradeRow = {
  campus: string;
  year: number;
  session: string;
  subject: string;
  courseNumber: string;
  detail: string | null;
  sectionCode: string;
  title: string;
  professors: string[];
  reported: number | null;
  average: number | null;
  median: number | null;
  high: number | null;
  low: number | null;
  /** Suppressed buckets stay null - never coerced to 0 (spec 6). */
  distribution: Record<GradeBucket, number | null>;
};

/** Blank means suppressed or unavailable - null, never 0. */
function num(value: string | undefined): number | null {
  const v = (value ?? '').trim();
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function str(value: string | undefined): string {
  return (value ?? '').trim();
}

/**
 * CSV split, quote-aware. The upstream feed quotes the Title field whenever
 * it contains a comma (e.g. "Thermodynamics, Kinetics and Organic
 * Chemistry") - a plain `line.split(',')` splits inside the quotes and
 * shifts every downstream column for every row of that course. Handles
 * standard CSV quoting: commas inside a quoted field aren't delimiters, and
 * `""` inside a quoted field is an escaped literal quote. Still no parsing
 * library - this format doesn't need one.
 */
function splitLine(line: string): string[] {
  const fields: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      fields.push(field);
      field = '';
    } else {
      field += ch;
    }
  }
  fields.push(field);
  return fields;
}

export function parseGradeCsv(text: string): RawGradeRow[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];

  const header = splitLine(lines[0]).map((h) => h.trim());
  const index = (name: string) => header.indexOf(name);

  const iYear = index('Year');
  const iSession = index('Session');
  const iSubject = index('Subject');
  const iCourse = index('Course');
  const iDetail = index('Detail');
  const iSection = index('Section');
  const iTitle = index('Title');
  const iProf = index('Professor');
  // The current export calls the student count "Reported"; the pre-2021
  // export (tableau-dashboard, 2014-2020) calls it "Enrolled". Falling back
  // matters more than it looks: a null count drops the row from
  // aggregateDistributions' weighted average entirely, so without this every
  // pre-2021 section would load but contribute nothing to a course average.
  const iReported = index('Reported') !== -1 ? index('Reported') : index('Enrolled');
  const iAvg = index('Avg');
  const iMedian = index('Median');
  const iHigh = index('High');
  const iLow = index('Low');
  const bucketIndex = GRADE_BUCKETS.map((b) => index(b));

  const rows: RawGradeRow[] = [];

  for (const line of lines.slice(1)) {
    const c = splitLine(line);
    const courseNumber = str(c[iCourse]);
    if (!courseNumber) continue;

    const distribution = {} as Record<GradeBucket, number | null>;
    GRADE_BUCKETS.forEach((bucket, i) => {
      distribution[bucket] = num(c[bucketIndex[i]]);
    });

    rows.push({
      campus: str(c[index('Campus')]),
      year: Number(str(c[iYear])),
      session: str(c[iSession]),
      subject: str(c[iSubject]),
      courseNumber,
      detail: str(c[iDetail]) || null,
      sectionCode: str(c[iSection]),
      title: str(c[iTitle]),
      // Co-taught sections list several names; blank means none (spec 5).
      professors: str(c[iProf])
        .split(';')
        .map((p) => p.trim())
        .filter(Boolean),
      reported: num(c[iReported]),
      average: num(c[iAvg]),
      median: num(c[iMedian]),
      high: num(c[iHigh]),
      low: num(c[iLow]),
      distribution,
    });
  }

  return rows;
}
