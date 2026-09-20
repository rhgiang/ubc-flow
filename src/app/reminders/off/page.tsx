// src/app/reminders/off/page.tsx
import Link from 'next/link';

/** Where muteReminders lands. Static, holds no token, and says nothing that
 *  depends on who is reading it, so it is safe to bookmark or re-open. */
export default function RemindersOffPage() {
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
