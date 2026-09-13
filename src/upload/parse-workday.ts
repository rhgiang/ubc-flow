import { parseUbcCourseCode } from '@/scrape/parse-nodes';

export type EnrollmentRow = {
  subjectCode: string;
  campus: string;
  courseNumber: string;
  sectionCode: string | null;
  activity: string | null;
  /** Start of the FIRST meeting block - what the term is inferred from. */
  startDate: string | null;
  /** Null for academic-record rows: that export carries no dates at all. */
  termYear: number | null;
  termSession: string | null;
  termNumber: number | null;
  days: string[];
  meetingStartTime: string | null;
  meetingEndTime: string | null;
  building: string | null;
  room: string | null;
  floor: string | null;
  /** End of the LAST meeting block - the real span across a reading-week split. */
  meetingEndDate: string | null;
  credits: number | null;
  registrationStatus: string | null;
  deliveryMode: string | null;
  /** Blank on most lab/tutorial rows - Workday only names the lecture's instructor. */
  instructor: string | null;
  /** The section's own Start/End Date columns, which span every meeting block. */
  sectionStartDate: string | null;
  sectionEndDate: string | null;
  /**
   * Workday's Grade cell, verbatim - a percentage, a letter, "CR", "TR".
   * Read here since the parser was written, but only to detect transfer
   * credit; the value itself was thrown away, so nothing downstream could
   * tell a pass from a fail.
   */
  grade: string | null;
  /** What this row means for a degree, rather than for a timetable. */
  status: 'registered' | 'passed' | 'failed';
};

/**
 * Credit earned elsewhere, reported separately because it is not an
 * enrollment.
 *
 * A transfer row has no UBC term and often no UBC course - "PHYS_V 1ST" is
 * unassigned first-year credit in a subject. It used to be discarded, which
 * overstated what a student still owed; it is now returned for the importer
 * to store, and deliberately kept out of EnrollmentRow so it can never reach
 * the review gate.
 */
export type TransferRow = {
  raw: string;
  subjectCode: string | null;
  courseNumber: string | null;
  campus: string | null;
  credits: number | null;
};

/**
 * What a Workday grade says about completion.
 *
 * Kept deliberately narrow. A percentage below 50 is a fail at UBC and a
 * letter F is a fail; "CR" is credit granted. Anything else - a blank cell, a
 * standing like "IP" or "W", a grading basis we do not know - stays
 * "registered", because guessing in the permissive direction is how a student
 * gets told they finished a course they have to retake.
 */
export function statusFromGrade(grade: string | null): 'registered' | 'passed' | 'failed' {
  const g = (grade ?? '').trim().toUpperCase();
  if (!g) return 'registered';
  if (g === 'CR' || g === 'P' || g === 'PASS') return 'passed';
  if (g === 'F' || g === 'FAIL' || g === 'D/F') return 'failed';
  const pct = Number(g.replace('%', ''));
  if (Number.isFinite(pct)) return pct >= 50 ? 'passed' : 'failed';
  // A letter grade: anything from A+ to D is a pass at UBC.
  if (/^[ABCD][+-]?$/.test(g)) return 'passed';
  return 'registered';
}

export type ExcludedRow = {
  raw: string;
  reason: 'transfer_credit' | 'unparseable_course' | 'no_term';
};

export type ParsedExport = {
  studentNumber: string | null;
  rows: EnrollmentRow[];
  transfers: TransferRow[];
  excluded: ExcludedRow[];
  /** Header rows found after the table we parsed - structures we don't handle yet. */
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

export type MeetingPattern = {
  startDate: string | null;
  endDate: string | null;
  days: string[];
  startTime: string | null;
  endTime: string | null;
  building: string | null;
  room: string | null;
  floor: string | null;
};

/**
 * "2026-09-09 - 2026-12-04 | Wed Fri | 10:00 a.m. - 11:30 a.m. | UBCV |
 * Hennings Building (HENN) | Floor: 1 | Room: 202"
 * -> the date range, the weekly day/time pattern, and the room location.
 */
function parseBlock(block: string): MeetingPattern {
  const ranges = [...block.matchAll(/(\d{4}-\d{2}-\d{2})\s*-\s*(\d{4}-\d{2}-\d{2})/g)];

  const segments = block.split('|').map((s) => s.trim());
  const days = (segments[1] ?? '').split(/\s+/).filter((d) => DAY_ABBREVIATIONS.has(d));
  const timeMatch = segments[2]?.match(/^(.+?)\s*-\s*(.+)$/);
  const building = segments[4] ? buildingCode(segments[4]) : null;
  const floorRaw = segments[5]?.replace(/^Floor:\s*/i, '').trim();
  const roomRaw = segments[6]?.replace(/^Room:\s*/i, '').trim();

  return {
    startDate: ranges[0]?.[1] ?? null,
    endDate: ranges[ranges.length - 1]?.[2] ?? null,
    days,
    startTime: timeMatch ? to24Hour(timeMatch[1]) : null,
    endTime: timeMatch ? to24Hour(timeMatch[2]) : null,
    building,
    room: roomRaw || null,
    floor: floorRaw || null,
  };
}

/**
 * A cell holds one blank-line-separated block per date range. Blocks that
 * repeat one weekly pattern (a course split around reading week) merge into a
 * single pattern spanning the first block's start to the last block's end.
 * A block with a DIFFERENT day, time or room is its own pattern - a real
 * lecture can meet Mon Wed 1–2 in one room and Fri 2–3 in another, and
 * reading only the first block dropped the Friday class from calendars.
 */
export function parseMeetingPatterns(cell: string): MeetingPattern[] {
  const patterns: MeetingPattern[] = [];
  for (const block of cell.split(/\n\s*\n/)) {
    if (!block.trim()) continue;
    const p = parseBlock(block);
    const same = patterns.find(
      (q) =>
        q.days.join(' ') === p.days.join(' ') &&
        q.startTime === p.startTime &&
        q.endTime === p.endTime &&
        q.building === p.building &&
        q.room === p.room &&
        q.floor === p.floor,
    );
    if (!same) {
      patterns.push(p);
      continue;
    }
    if (p.startDate && (!same.startDate || p.startDate < same.startDate)) same.startDate = p.startDate;
    if (p.endDate && (!same.endDate || p.endDate > same.endDate)) same.endDate = p.endDate;
  }
  return patterns;
}

/** No export carries a term column - derive it from the start date. */
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
  return grid.findIndex((r) =>
    r.some((c, i) => i > 0 && /Course Listing|Transfer Credit|^Course$/i.test(c.trim())),
  );
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
// row, e.g. "Transfer Credit from Coursework", is neither - it puts its text
// in column 0, so this predicate correctly does not treat it as a header.)
// Matching is restricted to whole words: real data cells routinely contain
// near-hits ("Graded" in the Grading Basis column) that must not be mistaken
// for a new table header.
const HEADER_HINT = /\b(Course Listing|Transfer Credit|Completed Coursework|Grade|Percentage Grades)\b/i;
function isTableHeaderRow(row: string[]): boolean {
  return !row[0] && row.some((c) => HEADER_HINT.test(c));
}

export function parseWorkdayExport(grid: string[][]): ParsedExport {
  const rows: EnrollmentRow[] = [];
  const transfers: TransferRow[] = [];
  const excluded: ExcludedRow[] = [];
  const seenStudents = new Set<string>();

  const hIdx = headerIndex(grid);
  if (hIdx === -1) {
    // No table we recognise anywhere in the file. Report every header-shaped
    // row we DID see (column labels only, never data), so the rejection can
    // say which table format a real export used that we have not met yet -
    // the first non-transfer student's academic record did exactly this.
    const unparsedTables = grid
      .filter((r) => isTableHeaderRow(r))
      .map((r) => r.filter(Boolean).join(' | '));
    return { studentNumber: null, rows, transfers, excluded, unparsedTables };
  }

  // The current table's data ends at the next row that looks like a header for
  // a further table (spec §8) - a senior student's export can hold more than
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
  const courseCol = cols['course listing'] ?? cols['transfer credit'] ?? cols['course'];
  const sectionCol = cols['section'];
  const statusCol = cols['registration status'];
  const activityCol = cols['instructional format'];
  const meetingCol = cols['meeting patterns'];
  const creditsCol = cols['credits'];
  const deliveryCol = cols['delivery mode'];
  const instructorCol = cols['instructor'];
  const startDateCol = cols['start date'];
  const endDateCol = cols['end date'];
  const gradeCol = cols['grade'];
  const originCol = cols['originating coursework'];
  // Read but never returned: `grading basis` and the column-0 student identity
  // (beyond the one-student check below) are deliberately not carried into
  // EnrollmentRow - a timetable needs neither.

  const cell = (row: string[], col: number | undefined): string | null =>
    col === undefined ? null : (row[col]?.trim() || null);

  for (const row of grid.slice(hIdx + 1, tableEnd)) {
    const identity = row[0] ?? '';
    const student = parseStudentNumber(identity);
    if (student) seenStudents.add(student);

    const listing = courseCol === undefined ? '' : (row[courseCol] ?? '');
    if (!listing) continue;

    // Transfer credit was earned at another institution. It is now KEPT - a
    // degree plan that ignores it overstates what a student still owes - and
    // carried as status 'transfer' so the review gate can refuse it while
    // guidance counts it. It must never grant review rights for UBC's version
    // of the course (spec 7B), which import enforces by leaving these rows
    // unverified.
    const grade = gradeCol === undefined ? '' : (row[gradeCol] ?? '');
    const origin = originCol === undefined ? '' : (row[originCol] ?? '');
    if (grade.trim().toUpperCase() === 'TR' || origin.trim()) {
      // Captured BEFORE the course-code and term checks, both of which a
      // transfer row fails by nature: "PHYS_V 1ST" is not a course code and
      // no UBC term granted the credit. Excluding it here was the old
      // behaviour and it understated a transfer student's progress.
      const parsed = parseUbcCourseCode(listing.split(' - ')[0]?.trim() ?? '');
      const rawCredits = cell(row, creditsCol);
      const n = rawCredits === null ? null : Number(rawCredits);
      transfers.push({
        raw: listing.trim(),
        subjectCode: parsed?.subjectCode ?? null,
        courseNumber: parsed?.number ?? null,
        campus: parsed?.campus ?? null,
        credits: Number.isFinite(n) ? n : null,
      });
      continue;
    }

    const code = parseUbcCourseCode(listing.split(' - ')[0]?.trim() ?? '');
    if (!code) {
      excluded.push({ raw: listing, reason: 'unparseable_course' });
      continue;
    }

    const patterns = parseMeetingPatterns(meetingCol === undefined ? '' : (row[meetingCol] ?? ''));
    const sectionStartDate = cell(row, startDateCol);

    // The Start Date column is the fallback: a section with no meeting pattern
    // at all (fully async) still belongs to a term, and used to be dropped.
    const term = inferTerm(patterns[0]?.startDate ?? sectionStartDate ?? '');
    // A table with neither column cannot date ANY of its rows - that is the
    // academic record, which lists what you took and what you got and nothing
    // about when. Those rows are kept without a term. A row missing a date in
    // a table that HAS the columns is a different thing, and still excluded.
    const tableCanDateRows = meetingCol !== undefined || startDateCol !== undefined;
    if (!term && tableCanDateRows) {
      excluded.push({ raw: listing, reason: 'no_term' });
      continue;
    }

    const rawCredits = cell(row, creditsCol);
    const credits = rawCredits === null ? null : Number(rawCredits);

    // One row per weekly pattern: a section meeting at two different times
    // registers each of them. A patternless row (fully async, or the academic
    // record) still yields its single row.
    for (const meeting of patterns.length > 0 ? patterns : [parseBlock('')]) {
      rows.push({
        subjectCode: code.subjectCode,
        campus: code.campus,
        courseNumber: code.number,
        sectionCode: sectionCol === undefined ? null : parseSectionCode(row[sectionCol] ?? ''),
        activity: cell(row, activityCol),
        startDate: meeting.startDate,
        days: meeting.days,
        meetingStartTime: meeting.startTime,
        meetingEndTime: meeting.endTime,
        meetingEndDate: meeting.endDate,
        building: meeting.building,
        room: meeting.room,
        floor: meeting.floor,
        credits: Number.isFinite(credits) ? credits : null,
        registrationStatus: cell(row, statusCol),
        deliveryMode: cell(row, deliveryCol),
        instructor: cell(row, instructorCol),
        sectionStartDate,
        sectionEndDate: cell(row, endDateCol),
        grade: grade.trim() || null,
        status: statusFromGrade(grade),
        termYear: term?.year ?? null,
        termSession: term?.session ?? null,
        termNumber: term?.termNumber ?? null,
      });
    }
  }

  if (seenStudents.size > 1) {
    throw new Error(
      'Export contains more than one student. A legitimate export covers one student.',
    );
  }

  // Everything from tableEnd on is outside the table we parsed. Report every
  // further header row we find there - structures we don't recognise yet
  // (e.g. "Completed Coursework" on a senior student's export). We cannot
  // parse a table we've never seen, but we can refuse to silently drop it.
  const unparsedTables = grid
    .slice(tableEnd)
    .filter((r) => isTableHeaderRow(r))
    .map((r) => r.filter(Boolean).join(' | '));

  return { studentNumber: [...seenStudents][0] ?? null, rows, transfers, excluded, unparsedTables };
}
