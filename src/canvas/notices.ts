// src/canvas/notices.ts
const H = 60 * 60 * 1000;
/** A lead window that opened longer ago than this is not fired: it was
 *  either handled by an earlier run or predates the connection, and a stale
 *  "3 days before" is noise. It also absorbs a late or missed cron run. */
export const WINDOW_GRACE_MS = 24 * H;

export type DeadlineForNotice = {
  id: string; title: string; courseName: string; dueAt: Date; allDay: boolean; url: string | null;
  movedFrom: Date | null; movedAt: Date | null; removedAt: Date | null;
};
export type Prefs = { enabled: boolean; leadHours: number[]; mutedCourses: string[] };
export type Notice = { deadline: DeadlineForNotice; key: string; kind: 'lead' | 'moved' | 'removed'; leadHours?: number };

/** Pure. `now` is injected so the rules are testable at a fixed instant. */
export function selectNotices(deadlines: DeadlineForNotice[], prefs: Prefs, now: Date): Notice[] {
  if (!prefs.enabled) return [];
  const t = now.getTime();
  const muted = new Set(prefs.mutedCourses);
  const maxLeadMs = Math.max(0, ...prefs.leadHours) * H;
  const inLargestWindow = (d: Date | null) => d !== null && d.getTime() > t && d.getTime() - t <= maxLeadMs;
  const out: Notice[] = [];

  for (const d of deadlines) {
    if (muted.has(d.courseName)) continue;
    const due = d.dueAt.getTime();

    if (d.removedAt) {
      if (inLargestWindow(d.dueAt)) out.push({ deadline: d, key: 'removed', kind: 'removed' });
      continue;
    }
    if (d.movedAt && (inLargestWindow(d.dueAt) || inLargestWindow(d.movedFrom))) {
      out.push({ deadline: d, key: `moved:${d.dueAt.toISOString()}`, kind: 'moved' });
    }
    if (due <= t) continue;
    for (const lead of prefs.leadHours) {
      const opens = due - lead * H;
      if (t >= opens && t < opens + WINDOW_GRACE_MS) {
        // The due date is part of the key, the same shape as `moved:` above.
        // Without it a lead claimed for the old date blocks the reminder for
        // the new one after the prof moves the deadline, and the student is
        // never told about the date that actually applies.
        out.push({ deadline: d, key: `lead:${lead}:${d.dueAt.toISOString()}`, kind: 'lead', leadHours: lead });
      }
    }
  }
  return out;
}
