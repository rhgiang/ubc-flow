'use server';

import { db } from '@/lib/db';
import { auth } from '@/lib/auth';
import { isMode, type Mode } from '@/lib/theme';

/**
 * Persist the signed-in user's theme choice so it follows the account to a
 * new browser or device. localStorage already covers "same browser, next
 * visit"; this covers everything else.
 *
 * Deliberately silent: the toggle fires this and forgets. A signed-out
 * visitor, or a failed write, costs nothing - localStorage has already
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

/**
 * The caller's own saved theme mode, fetched by ThemeToggle after hydration.
 * This used to be read during the layout's render (src/lib/saved-theme.ts),
 * but auth() there forced every page dynamic; the pre-paint script now runs
 * on localStorage alone and this call reconciles the account's choice a
 * moment later. Null for a signed-out visitor, one who has never chosen, or
 * on any failure - all of which mean "leave the local theme alone".
 */
export async function savedThemeMode(): Promise<Mode | null> {
  try {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) return null;
    const user = await db.user.findUnique({
      where: { id: userId },
      select: { themeMode: true },
    });
    return isMode(user?.themeMode) ? user.themeMode : null;
  } catch {
    return null;
  }
}
