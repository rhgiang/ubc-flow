'use server';

import { readWorkbookGrid } from '@/upload/read-grid';
import { parseWorkdayExport } from '@/upload/parse-workday';
import { matchWorkdayRows, type ScheduleImport } from '@/upload/match-schedule';

const MAX_BYTES = 1 * 1024 * 1024;
// A real export is ~12 rows. Sheet XML compresses hard, so the byte cap above
// does not bound row count - this does.
const MAX_ROWS = 200;

/** A parsed row that will not appear in the schedule, with the REAL reason. */
export type SkippedRow = { raw: string; reason: string };

export type ImportResult =
  | ({ ok: true } & ScheduleImport & { skipped: SkippedRow[] })
  | { ok: false; error: string; skipped?: SkippedRow[] };

const REASON_TEXT: Record<string, string> = {
  transfer_credit: 'Transfer credit, earned at another institution',
  unparseable_course: "Course code couldn't be read",
  no_term: 'No meeting dates, so the term is unknown',
};

/**
 * Parses a Workday export and resolves it to catalogue sections for the
 * schedule builder. Writes NOTHING.
 *
 * Deliberately separate from /api/upload: that endpoint binds studentIdHash
 * and writes Enrollment rows, which is right for account verification and
 * wrong here - previewing a timetable must not bind a student's identity as a
 * side effect, and the builder is usable signed out.
 */
export async function parseWorkdayForSchedule(formData: FormData): Promise<ImportResult> {
  const file = formData.get('file');
  if (!(file instanceof File)) return { ok: false, error: 'No file uploaded.' };
  // Size is checked BEFORE parsing - a zip bomb must never reach the parser.
  if (file.size > MAX_BYTES) return { ok: false, error: 'File is too large (max 1 MB).' };
  if (!file.name.toLowerCase().endsWith('.xlsx')) {
    return { ok: false, error: 'Upload the .xlsx export from Workday.' };
  }

  try {
    // Held in memory only - never written to disk, never logged.
    const grid = await readWorkbookGrid(await file.arrayBuffer());
    const parsed = parseWorkdayExport(grid);

    if (parsed.rows.length > MAX_ROWS) {
      return {
        ok: false,
        error:
          "That file has far more rows than a timetable export. It doesn't look like a View My Courses export.",
      };
    }

    // Each excluded row keeps its own reason. Reporting all three as
    // "transfer credits" is the bug spec §8.2 calls out on the Account page.
    const skipped = parsed.excluded.map((e) => ({
      raw: e.raw,
      reason: REASON_TEXT[e.reason] ?? e.reason,
    }));

    const result = await matchWorkdayRows(parsed.rows);
    if (!result) {
      return {
        ok: false,
        error:
          "We couldn't find a term in that file. Export from Workday → Student → Academics → Registration & Courses → View My Courses.",
        skipped,
      };
    }

    return { ok: true, ...result, skipped };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not read that file.' };
  }
}
