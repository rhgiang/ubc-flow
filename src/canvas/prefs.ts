// src/canvas/prefs.ts  (plain module, no 'use server': a constant lives here
// and the client component needs it; a 'use server' file may export only
// async functions.)
import { db } from '@/lib/db';
import type { Result } from '@/canvas/connect';

// 1, 2, 3 and 7 days. The sync job runs every four hours, so a shorter lead
// would fire only if a run happened to land inside that window, a promise
// the job cannot keep.
export const LEAD_CHOICES = [24, 48, 72, 168] as const;
const MAX_MUTES = 100;

/**
 * Validates and stores a student's reminder settings. Leads are deduplicated
 * and sorted longest first, matching the order the page and the emails
 * should read them in. Mutes are trimmed, deduplicated, and capped so a
 * pasted list of every course code in the calendar can't grow the row
 * without bound.
 *
 * No revalidatePath here: it only works inside a Server Function's request
 * context, and this function is called directly by tests with no such
 * context (same reasoning as src/canvas/connect.ts). The action wrapper in
 * src/app/actions/canvas.ts revalidates after a successful call.
 */
export async function updateReminderPreferencesFor(
  userId: string,
  input: { leadHours: number[]; mutedCourses: string[] },
): Promise<Result> {
  const uniqueInput = new Set(input.leadHours);
  const leads = [...uniqueInput]
    .filter((h): h is (typeof LEAD_CHOICES)[number] => (LEAD_CHOICES as readonly number[]).includes(h))
    .sort((a, b) => b - a);
  // Empty means nothing valid was picked; a shorter length than the input's
  // unique count means something outside LEAD_CHOICES got filtered out. Both
  // are rejected rather than silently honouring a partial choice.
  if (leads.length === 0 || leads.length !== uniqueInput.size) {
    return { ok: false, error: 'Pick at least one reminder time from the list.' };
  }

  const mutes = [...new Set(input.mutedCourses.map((c) => c.trim()).filter(Boolean))];
  if (mutes.length > MAX_MUTES || mutes.some((c) => c.length > 200)) {
    return { ok: false, error: 'Too many muted courses.' };
  }

  await db.reminderPreference.upsert({
    where: { userId },
    create: { userId, leadHours: leads, mutedCourses: mutes },
    update: { leadHours: leads, mutedCourses: mutes },
  });
  return { ok: true };
}
