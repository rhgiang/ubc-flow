import { parseUbcCourseCode } from '@/scrape/parse-nodes';

export type EnrollmentRow = {
  subjectCode: string;
  campus: string;
  courseNumber: string;
  sectionCode: string | null;
  activity: string | null;
  startDate: string | null;
  termYear: number;
  termSession: string;
  termNumber: number | null;
  days: string[];
  meetingStartTime: string | null;
  meetingEndTime: string | null;
  building: string | null;
  room: string | null;
};

export type ExcludedRow = {
  raw: string;
  reason: 'transfer_credit' | 'unparseable_course' | 'no_term';
};

export type ParsedExport = {
  studentNumber: string | null;
  rows: EnrollmentRow[];
  excluded: ExcludedRow[];
  /** Header rows found after the table we parsed — structures we don't handle yet. */
  unparsedTables: string[];
};

const IDENTITY = /\((\d{6,10})\)/;

export function parseStudentNumber(cell: string): string | null {
  return cell.match(IDENTITY)?.[1] ?? null;
}

/** "CPSC_V 110-L1U - Computation, Programs" -> "L1U" */
export function parseSectionCode(cell: string): string | null {
  const m = cell.match(/^[A-Z]{2,6}_[VO]\s+\d{3}[A-Z]?-(\S+?)\s+-\s+/);
  return m?.[1] ?? null;
}

const DAY_ABBREVIATIONS = new Set(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);

/** "10:00 a.m." -> "10:00", "3:30 p.m." -> "15:30". Null on anything else. */
function to24Hour(t: string): string | null {
  const m = t.trim().match(/^(\d{1,2}):(\d{2})\s*([ap])\.?m\.?$/i);
  if (!m) return null;
  let h = Number(m[1]);
  const isPM = m[3].toLowerCase() === 'p';
  if (isPM && h !== 12) h += 12;
  if (!isPM && h === 12) h = 0;
  return `${String(h).padStart(2, '0')}:${m[2]}`;
}

/**
 * "Hennings Building (HENN)" -> "HENN". The building's short code is the LAST
 * parenthetical, because some names repeat the code up front:
 * "CIRS (Centre for Interactive Research on Sustainability) (CIRS)".
 * A segment with no parenthetical is used as-is rather than dropped.
 */
function buildingCode(segment: string): string | null {
  const trimmed = segment.trim();
  if (!trimmed) return null;
  const m = trimmed.match(/\(([^()]*)\)\s*$/);
  return (m ? m[1].trim() : trimmed) || null;
}

/**
 * "2026-09-09 - 2026-12-04 | Wed Fri | 10:00 a.m. - 11:30 a.m. | UBCV |
 * Hennings Building (HENN) | Floor: 1 | Room: 202"
 * -> the date range, the weekly day/time pattern, and the room location.
 *
 * A cell can hold more than one date-range block, blank-line separated
 * (e.g. a course split around reading week) — every block for one section
 * repeats the same days/time, so only the first block's days/time are read.
 */
export function parseMeetingPattern(cell: string): {
  startDate: string | null;
  endDate: string | null;
  days: string[];
  startTime: string | null;
  endTime: string | null;
  building: string | null;
  room: string | null;
} {
  const dateMatch = cell.match(/(\d{4}-\d{2}-\d{2})\s*-\s*(\d{4}-\d{2}-\d{2})/);

  const firstBlock = cell.split(/\n\s*\n/)[0] ?? '';
  const segments = firstBlock.split('|').map((s) => s.trim());
  const days = (segments[1] ?? '').split(/\s+/).filter((d) => DAY_ABBREVIATIONS.has(d));
  const timeMatch = segments[2]?.match(/^(.+?)\s*-\s*(.+)$/);
  const building = segments[4] ? buildingCode(segments[4]) : null;
  const roomRaw = segments[6]?.replace(/^Room:\s*/i, '').trim();
  const room = roomRaw || null;

  return {
    startDate: dateMatch?.[1] ?? null,
    endDate: dateMatch?.[2] ?? null,
    days,
    startTime: timeMatch ? to24Hour(timeMatch[1]) : null,
    endTime: timeMatch ? to24Hour(timeMatch[2]) : null,
    building,
    room,
  };
}

/** No export carries a term column — derive it from the start date. */
export function inferTerm(
  isoDate: string,
): { year: number; session: string; termNumber: number | null } | null {
  const m = isoDate.match(/^(\d{4})-(\d{2})-\d{2}$/);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);

  if (month >= 9) return { year, session: 'W', termNumber: 1 };
  if (month <= 4) return { year: year - 1, session: 'W', termNumber: 2 };
  return { year, session: 'S', termNumber: null };
}

// Real exports carry a banner/title row (e.g. "Transfer Credit from Coursework")
// in column A above the real header row, and that banner text can itself contain
// "Transfer Credit". Column A also holds the per-row student identity, never a
// column label, so a genuine header's matching cell is never at index 0.
function headerIndex(grid: string[][]): number {
  return grid.findIndex((r) => r.some((c, i) => i > 0 && /Course Listing|Transfer Credit/i.test(c)));
}

function columnMap(header: string[]): Record<string, number> {
  const map: Record<string, number> = {};
  header.forEach((h, i) => {
    const key = h.toLowerCase().trim();
    if (key) map[key] = i;
  });
  return map;
}

// A header row for ANY table (the one we parse, or a further one we don't)
// always has an empty column 0: that column holds only the per-row student
// identity on real data rows, and headers never carry that. (A title BANNER
// row, e.g. "Transfer Credit from Coursework", is neither — it puts its text
// in column 0, so this predicate correctly does not treat it as a header.)
// Matching is restricted to whole words: real data cells routinely contain
// near-hits ("Graded" in the Grading Basis column) that must not be mistaken
// for a new table header.
const HEADER_HINT = /\b(Course Listing|Transfer Credit|Completed Coursework|Grade)\b/i;
function isTableHeaderRow(row: string[]): boolean {
  return !row[0] && row.some((c) => HEADER_HINT.test(c));
}

export function parseWorkdayExport(grid: string[][]): ParsedExport {
  const rows: EnrollmentRow[] = [];
  const excluded: ExcludedRow[] = [];
  const seenStudents = new Set<string>();

  const hIdx = headerIndex(grid);
  if (hIdx === -1) return { studentNumber: null, rows, excluded, unparsedTables: [] };

  // The current table's data ends at the next row that looks like a header for
  // a further table (spec §8) — a senior student's export can hold more than
  // one table, and reading past this boundary with the FIRST table's column
  // map would misread the second table's columns as this table's, including
  // possibly reading course-code-shaped text through a map with no
  // gradeCol/originCol to exclude it as transfer credit.
  let tableEnd = grid.length;
  for (let i = hIdx + 1; i < grid.length; i++) {
    if (isTableHeaderRow(grid[i])) {
      tableEnd = i;
      break;
    }
  }

  const cols = columnMap(grid[hIdx]);
  const courseCol = cols['course listing'] ?? cols['transfer credit'];
  const sectionCol = cols['section'];
  const statusCol = cols['registration status'];
  const activityCol = cols['instructional format'];
  const meetingCol = cols['meeting patterns'];
  const gradeCol = cols['grade'];
  const originCol = cols['originating coursework'];

  for (const row of grid.slice(hIdx + 1, tableEnd)) {
    const identity = row[0] ?? '';
    const student = parseStudentNumber(identity);
    if (student) seenStudents.add(student);

    const listing = courseCol === undefined ? '' : (row[courseCol] ?? '');
    if (!listing) continue;

    // Transfer credit was earned at another institution — it must never grant
    // review rights for UBC's version of the course (spec 7B).
    const grade = gradeCol === undefined ? '' : (row[gradeCol] ?? '');
    const origin = originCol === undefined ? '' : (row[originCol] ?? '');
    if (grade.trim().toUpperCase() === 'TR' || origin.trim()) {
      excluded.push({ raw: listing, reason: 'transfer_credit' });
      continue;
    }

    const code = parseUbcCourseCode(listing.split(' - ')[0]?.trim() ?? '');
    if (!code) {
      excluded.push({ raw: listing, reason: 'unparseable_course' });
      continue;
    }

    const meeting = meetingCol === undefined
      ? { startDate: null, endDate: null, days: [], startTime: null, endTime: null, building: null, room: null }
      : parseMeetingPattern(row[meetingCol] ?? '');

    const term = meeting.startDate ? inferTerm(meeting.startDate) : null;
    if (!term) {
      excluded.push({ raw: listing, reason: 'no_term' });
      continue;
    }

    rows.push({
      subjectCode: code.subjectCode,
      campus: code.campus,
      courseNumber: code.number,
      sectionCode: sectionCol === undefined ? null : parseSectionCode(row[sectionCol] ?? ''),
      activity: activityCol === undefined ? null : (row[activityCol] || null),
      startDate: meeting.startDate,
      days: meeting.days,
      meetingStartTime: meeting.startTime,
      meetingEndTime: meeting.endTime,
      building: meeting.building,
      room: meeting.room,
      termYear: term.year,
      termSession: term.session,
      termNumber: term.termNumber,
    });
  }

  if (seenStudents.size > 1) {
    throw new Error(
      'Export contains more than one student — a legitimate export covers one student.',
    );
  }

  // statusCol is read to keep the contract explicit even when unused today:
  // every fixture row is "Registered", and in-progress rows DO grant rights.
  void statusCol;

  // Everything from tableEnd on is outside the table we parsed. Report every
  // further header row we find there — structures we don't recognise yet
  // (e.g. "Completed Coursework" on a senior student's export). We cannot
  // parse a table we've never seen, but we can refuse to silently drop it.
  const unparsedTables = grid
    .slice(tableEnd)
    .filter((r) => isTableHeaderRow(r))
    .map((r) => r.filter(Boolean).join(' | '));

  return { studentNumber: [...seenStudents][0] ?? null, rows, excluded, unparsedTables };
}
