import { db } from '@/lib/db';
import type { ScheduleOption } from '@/components/schedule/ScheduleSwitcher';

/**
 * The student's saved schedules, labelled with their term, for the builder's
 * switcher.
 *
 * SavedSchedule.termId is a raw FK with no Prisma relation to Term, so the
 * names are resolved from a term list the caller already had to fetch rather
 * than through an include.
 */
export async function listSwitchableSchedules(
  userId: string | undefined,
  terms: { id: string; name: string }[],
): Promise<ScheduleOption[]> {
  if (!userId) return [];

  const rows = await db.savedSchedule.findMany({
    where: { userId },
    select: { id: true, name: true, termId: true },
  });

  const termNames = new Map(terms.map((t) => [t.id, t.name]));
  return rows
    .map((r) => ({
      id: r.id,
      name: r.name,
      // A schedule can sit in a term the builder no longer offers (it has since
      // passed), so this falls back rather than dropping the row.
      termName: termNames.get(r.termId) ?? 'Past term',
    }))
    .sort((a, b) => a.termName.localeCompare(b.termName) || a.name.localeCompare(b.name));
}
