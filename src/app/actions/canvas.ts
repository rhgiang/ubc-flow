// src/app/actions/canvas.ts
'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { consumeToken } from '@/lib/mail';
import { connectCanvasFeedFor, disconnectCanvasFeedFor, refreshCanvasFeedFor, type Result } from '@/canvas/connect';
import { addManualDeadlineFor, removeManualDeadlineFor, type ManualDeadlineInput } from '@/canvas/manual';
import { updateReminderPreferencesFor } from '@/canvas/prefs';
import {
  addTodoFor,
  removeTodoFor,
  reorderBoardFor,
  setBoardNoteFor,
  setDeadlineOnBoardFor,
  setTodoDoneFor,
} from '@/canvas/todos';

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

export async function refreshCanvasFeed(): Promise<Result> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'Not signed in.' };
  const result = await refreshCanvasFeedFor(session.user.id);
  if (result.ok) {
    revalidatePath('/deadlines');
    revalidatePath('/onboarding');
  }
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

/**
 * Tick a deadline off, or un-tick it. Student-set only: no poll ever writes
 * this, so a sync cannot undo it.
 *
 * The userId is part of the WHERE rather than checked first, so a request
 * naming someone else's deadline id matches no row and changes nothing. That
 * is also why it reports the same "Not found." either way: a caller must not
 * be able to tell another student's real id from a made-up one.
 */
export async function setDeadlineDone(id: string, done: boolean): Promise<Result> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'Not signed in.' };
  const { count } = await db.canvasDeadline.updateMany({
    where: { id, userId: session.user.id },
    data: { completedAt: done ? new Date() : null },
  });
  if (count === 0) return { ok: false, error: 'Not found.' };
  revalidatePath('/deadlines');
  return { ok: true };
}

/**
 * Adds a deadline the student typed themselves - a midterm, a club meeting,
 * anything Canvas does not carry. Session-reading wrapper only; the
 * validation and the write are in src/canvas/manual.ts.
 */
export async function addDeadline(input: ManualDeadlineInput): Promise<Result> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'Not signed in.' };
  const result = await addManualDeadlineFor(session.user.id, input);
  if (result.ok) revalidatePath('/deadlines');
  return result;
}

/** Deletes one the student added. Only those: a feed row is marked removed,
 *  never deleted, and removeManualDeadlineFor enforces that. */
export async function removeDeadline(id: string): Promise<Result> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'Not signed in.' };
  const result = await removeManualDeadlineFor(session.user.id, id);
  if (result.ok) revalidatePath('/deadlines');
  return result;
}

// The todo board. Session-reading wrappers only; the rules and the writes
// live in src/canvas/todos.ts, which a test can call with no request context.

export async function addTodo(title: string): Promise<Result> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'Not signed in.' };
  const result = await addTodoFor(session.user.id, title);
  if (result.ok) revalidatePath('/deadlines');
  return result;
}

export async function setTodoDone(id: string, done: boolean): Promise<Result> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'Not signed in.' };
  const result = await setTodoDoneFor(session.user.id, id, done);
  if (result.ok) revalidatePath('/deadlines');
  return result;
}

export async function removeTodo(id: string): Promise<Result> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'Not signed in.' };
  const result = await removeTodoFor(session.user.id, id);
  if (result.ok) revalidatePath('/deadlines');
  return result;
}

/**
 * Saves the order the student dragged the board into.
 *
 * No revalidatePath. The board already shows the new order, because the drag
 * is what put it there, and the client's own refresh runs after this has
 * returned - so by the time the page is read again the new order is what is
 * in the table. Busting the cache on top of that would buy nothing.
 */
export async function reorderBoard(
  order: { id: string; kind: 'deadline' | 'todo' }[],
): Promise<Result> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'Not signed in.' };
  return reorderBoardFor(session.user.id, order);
}

/** Saves the student's note on a board row, either kind. */
export async function setBoardNote(
  kind: 'deadline' | 'todo',
  id: string,
  note: string,
): Promise<Result> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'Not signed in.' };
  if (kind !== 'deadline' && kind !== 'todo') return { ok: false, error: 'Not found.' };
  if (typeof id !== 'string' || typeof note !== 'string') return { ok: false, error: 'Not found.' };
  return setBoardNoteFor(session.user.id, kind, id, note);
}

/** Puts a deadline on the board, or takes it off. Never removes the deadline. */
export async function setDeadlineOnBoard(id: string, onBoard: boolean): Promise<Result> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'Not signed in.' };
  const result = await setDeadlineOnBoardFor(session.user.id, id, onBoard);
  if (result.ok) revalidatePath('/deadlines');
  return result;
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
