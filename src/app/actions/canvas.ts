// src/app/actions/canvas.ts
'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { consumeToken } from '@/lib/mail';
import { connectCanvasFeedFor, disconnectCanvasFeedFor, type Result } from '@/canvas/connect';
import { updateReminderPreferencesFor } from '@/canvas/prefs';

// Only session-reading functions are exported here. Anything that takes a
// userId lives in src/canvas/connect.ts: an export from this file is an
// endpoint, and an endpoint that trusts a caller-supplied userId is a hole.
//
// revalidatePath is called here, not in connect.ts: it only works inside a
// Server Function's request context, and connect.ts's *For functions are
// called directly by tests with no such context (same pattern as
// src/app/actions/schedule.ts's renameSchedule/deleteSchedule).

export async function connectCanvasFeed(input: string): Promise<Result> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'Not signed in.' };
  const result = await connectCanvasFeedFor(session.user.id, input);
  if (result.ok) revalidatePath('/onboarding');
  return result;
}

export async function disconnectCanvasFeed(): Promise<Result> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'Not signed in.' };
  const result = await disconnectCanvasFeedFor(session.user.id);
  if (result.ok) revalidatePath('/onboarding');
  return result;
}

/**
 * The mute link's form posts here. The exception to the rule above: it takes
 * a token, not a userId, and the token is the authorisation. Whoever opens a
 * mute link from their inbox is usually signed out, so no session is read.
 *
 * Consuming happens here rather than while rendering /reminders/[token], so
 * a mail scanner fetching the URL cannot turn a student's reminders off.
 * A spent or bogus token still lands on the confirmation: the page it came
 * from already checked the token, and a student who clicks the same link
 * twice should not be told something went wrong when nothing did.
 */
export async function muteReminders(formData: FormData): Promise<void> {
  const result = await consumeToken(String(formData.get('token') ?? ''), 'mute');
  if (result.ok && result.userId) {
    await db.reminderPreference.upsert({
      where: { userId: result.userId },
      create: { userId: result.userId, enabled: false },
      update: { enabled: false },
    });
  }
  redirect('/reminders/off');
}

// Turns reminders back on (or off) for the signed-in student. muteReminders
// above is the signed-out path, keyed on a token instead of a session.
export async function setRemindersEnabled(enabled: boolean): Promise<Result> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'Not signed in.' };
  await db.reminderPreference.upsert({
    where: { userId: session.user.id },
    create: { userId: session.user.id, enabled },
    update: { enabled },
  });
  revalidatePath('/deadlines');
  return { ok: true };
}

// Session-reading wrapper only; the validation and the write live in
// src/canvas/prefs.ts so a test can call updateReminderPreferencesFor
// directly with no request context.
export async function updateReminderPreferences(input: { leadHours: number[]; mutedCourses: string[] }): Promise<Result> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'Not signed in.' };
  const result = await updateReminderPreferencesFor(session.user.id, input);
  if (result.ok) revalidatePath('/deadlines');
  return result;
}
