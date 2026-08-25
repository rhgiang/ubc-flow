import 'server-only';
import { db } from '@/lib/db';
import { auth } from '@/lib/auth';
import { isMode, type Mode } from '@/lib/theme';

/**
 * The signed-in user's saved theme mode, for seeding the pre-paint script.
 *
 * Kept out of app/actions/theme.ts deliberately: everything exported from a
 * 'use server' module becomes a callable endpoint, and this is only ever
 * read during the layout's own render.
 *
 * Null for a signed-out visitor, for one who has never chosen, or on any
 * failure — every one of those cases falls through to localStorage and then
 * to campus weather, so a database hiccup costs a seed, not a page.
 */
export async function getSavedThemeMode(): Promise<Mode | null> {
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
