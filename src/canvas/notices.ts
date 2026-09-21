// src/canvas/notices.ts
const H = 60 * 60 * 1000;
/** A lead window that opened longer ago than this is not fired: it was
 *  either handled by an earlier run or predates the connection, and a stale
 *  "3 days before" is noise. It also absorbs a late or missed cron run. */
export const WINDOW_GRACE_MS = 24 * H;
/** How long a move or a removal stays news. Exported and shared with
 *  src/app/deadlines/page.tsx so the page and the email cannot drift: a prof
 *  who shifts a December midterm in September must not have it announced as
 *  news in December, when the page stopped showing the move months earlier.
 *  Spec section 5: an out-of-window move shows on the page, not in mail. */
export const RECENT_MS = 14 * 24 * H;

/** A deadline an hour past is still worth a glance; yesterday's is not. */
const PAST_GRACE_MS = 24 * H;

/**
 * Whether a deadline still belongs on the deadlines page. The page's job is
 * what is next, so something already due drops off a day later, however long
 * the term's backlog. A recent removal or move is the exception: "your
 * instructor removed yesterday's quiz" is news worth a line.
 *
 * Here rather than in the page so the same 14 day window governs both what
 * the page shows and what selectNotices emails about.
 */
export function stillWorthShowing(
  d: { dueAt: Date; movedAt: Date | null; removedAt: Date | null },
  now: number,
): boolean {
  const recent = (at: Date | null) => at !== null && now - at.getTime() <= RECENT_MS;
  if (d.removedAt) return recent(d.removedAt);
  return d.dueAt.getTime() > now - PAST_GRACE_MS || recent(d.movedAt);
}

export type DeadlineForNotice = {
  id: string; title: string; courseName: string; dueAt: Date; allDay: boolean; url: string | null;
  movedFrom: Date | null; movedAt: Date | null; removedAt: Date | null; completedAt: Date | null;
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
    // Ticked off. The work is in, so neither a reminder nor news that the
    // professor moved or withdrew it is worth an email.
    if (d.completedAt) continue;
    const due = d.dueAt.getTime();

    if (d.removedAt) {
      if (inLargestWindow(d.dueAt)) out.push({ deadline: d, key: 'removed', kind: 'removed' });
      continue;
    }
    // movedAt is set once and never cleared, so the lead window alone is not
    // enough: the move has to still be recent as well.
    const movedRecently = d.movedAt !== null && t - d.movedAt.getTime() <= RECENT_MS;
    if (movedRecently && (inLargestWindow(d.dueAt) || inLargestWindow(d.movedFrom))) {
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
