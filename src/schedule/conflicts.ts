export type ScheduleEntry = {
  sectionId: string;
  label: string;
  day: string;
  startTime: string | null;
  endTime: string | null;
};

export type ConflictPair = { a: ScheduleEntry; b: ScheduleEntry };

/** "14:30" -> 870. Null for anything unparseable. */
function minutes(hhmm: string | null): number | null {
  const m = hhmm?.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/**
 * Overlapping meetings on the same day. Advisory only — the caller warns, it
 * never blocks: UBC's meeting data can't always prove a conflict is real
 * (alternating-week patterns), so refusing an add would sometimes be wrong.
 */
export function findConflicts(entries: ScheduleEntry[]): ConflictPair[] {
  const pairs: ConflictPair[] = [];

  for (let i = 0; i < entries.length; i += 1) {
    for (let j = i + 1; j < entries.length; j += 1) {
      const a = entries[i];
      const b = entries[j];
      if (a.day !== b.day) continue;
      if (a.sectionId === b.sectionId) continue;

      const aStart = minutes(a.startTime);
      const aEnd = minutes(a.endTime);
      const bStart = minutes(b.startTime);
      const bEnd = minutes(b.endTime);
      // An unscheduled meeting has nothing to conflict with — never guess.
      if (aStart === null || aEnd === null || bStart === null || bEnd === null) continue;

      // Strict inequality: back-to-back classes are not a conflict.
      if (aStart < bEnd && bStart < aEnd) pairs.push({ a, b });
    }
  }

  return pairs;
}
