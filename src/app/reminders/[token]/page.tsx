// src/app/reminders/[token]/page.tsx
import { peekToken } from '@/lib/mail';
import { muteReminders } from '@/app/actions/canvas';

/**
 * A mute link lands in an inbox, so whoever opens it is usually signed out.
 * No session is consulted: the token names the student.
 *
 * Rendering must not change anything. UBC runs Microsoft 365 and Defender
 * Safe Links fetches the URLs in inbound mail, so a page that muted on GET
 * would be muted by the scanner before the student saw it, and the token
 * would already be spent. This page only peeks at the token; the button
 * posts it to muteReminders, which consumes it and redirects to
 * /reminders/off. Plain form, plain server action, no client JavaScript.
 *
 * /reminders/off is a static segment and beats this dynamic one in the App
 * Router, and tokens are 64 hex characters, so the two cannot collide.
 */
export const dynamic = 'force-dynamic';

export default async function MutePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const result = await peekToken(token, 'mute');

  if (!result.ok) {
    return (
      <main className="mx-auto w-full max-w-lg px-4 py-10 sm:px-6">
        <p className="text-sm text-text-secondary">
          That link has expired. Sign in and change reminders from your deadlines page.
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-lg px-4 py-10 sm:px-6">
      <h1 className="text-xl font-semibold text-foreground">Stop Canvas deadline emails?</h1>
      <p className="mt-2 text-sm text-text-secondary">
        This turns off every Canvas deadline reminder for your UBC Flow account. Your deadlines
        page keeps working, and you can turn reminders back on there any time.
      </p>
      <form action={muteReminders} className="mt-4">
        <input type="hidden" name="token" value={token} />
        <button
          type="submit"
          className="rounded-pill bg-brand px-4 py-1.5 text-sm font-medium text-brand-foreground"
        >
          Turn reminders off
        </button>
      </form>
    </main>
  );
}
