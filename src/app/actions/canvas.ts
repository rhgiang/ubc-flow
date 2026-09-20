// src/app/actions/canvas.ts
'use server';

import { revalidatePath } from 'next/cache';
import { auth } from '@/lib/auth';
import { connectCanvasFeedFor, disconnectCanvasFeedFor, type Result } from '@/canvas/connect';

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
