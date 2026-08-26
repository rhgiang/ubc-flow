'use server';

import { db } from '@/lib/db';
import { auth } from '@/lib/auth';
import { isMode } from '@/lib/theme';

/**
 * Persist the signed-in user's theme choice so it follows the account to a
 * new browser or device. localStorage already covers "same browser, next
 * visit"; this covers everything else.
 *
 * Deliberately silent: the toggle fires this and forgets. A signed-out
 * visitor, or a failed write, costs nothing — localStorage has already
 * applied the choice locally, so there is nothing to tell the user about
 * and nothing to roll back.
 */
export async function saveThemeMode(mode: string): Promise<void> {
  if (!isMode(mode)) return;
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return;
  try {
    await db.user.update({ where: { id: userId }, data: { themeMode: mode } });
  } catch {
    // A theme preference is not worth surfacing an error for.
  }
}
