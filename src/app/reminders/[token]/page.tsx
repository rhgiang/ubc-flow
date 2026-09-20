// src/app/reminders/[token]/page.tsx
import Link from 'next/link';
import { consumeToken } from '@/lib/mail';
import { db } from '@/lib/db';

/**
 * A mute link lands in an inbox, so whoever clicks it is usually signed out.
 * No session is consulted: the token names the userId, and that user's
 * reminders are turned off directly with db, the same shape as the shared
 * schedule link.
 *
 * This page must never host anything that re-renders it: consumeToken
 * deletes the token's row on the first render, so a second render of the
 * same request (a form action on this route revalidating it, for instance)
 * would find no row and fall into the expired branch below, even though the
 * first render already succeeded. Turning reminders back on is therefore a
 * plain link to /deadlines, not a form here: that page is signed-in-scoped,
 * not keyed on a consumed token, so it can host setRemindersEnabled safely.
 */
export const dynamic = 'force-dynamic';

export default async function MutePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const result = await consumeToken(token, 'mute');

  if (!result.ok || !result.userId) {
    return (
      <main className="mx-auto w-full max-w-lg px-4 py-10 sm:px-6">
        <p className="text-sm text-text-secondary">
          That link has expired. Sign in and change reminders from your deadlines page.
        </p>
      </main>
    );
  }

  await db.reminderPreference.upsert({
    where: { userId: result.userId },
    create: { userId: result.userId, enabled: false },
    update: { enabled: false },
  });

  return (
    <main className="mx-auto w-full max-w-lg px-4 py-10 sm:px-6">
      <h1 className="text-xl font-semibold text-foreground">Reminders are off</h1>
      <p className="mt-2 text-sm text-text-secondary">
        You will not get any more Canvas deadline emails.
      </p>
      <p className="mt-4 text-sm">
        <Link href="/deadlines" className="font-medium underline underline-offset-4">
          Change reminders from your deadlines page
        </Link>
      </p>
    </main>
  );
}
