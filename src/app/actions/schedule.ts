'use server';

import { randomBytes } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { auth } from '@/lib/auth';

type Result = { ok: true } | { ok: false; error: string };
type CreateResult = { ok: true; scheduleId: string } | { ok: false; error: string };
type TokenResult = { ok: true; token: string } | { ok: false; error: string };

const NOT_YOURS = 'That schedule does not belong to you.';

/** Ownership check — every mutation goes through this first. */
async function owns(userId: string, scheduleId: string): Promise<boolean> {
  const found = await db.savedSchedule.findFirst({
    where: { id: scheduleId, userId },
    select: { id: true },
  });
  return found !== null;
}

export async function createScheduleFor(
  userId: string,
  termId: string,
  name: string,
): Promise<CreateResult> {
  const clean = name.trim();
  if (!clean) return { ok: false, error: 'Give the schedule a name.' };
  if (clean.length > 80) return { ok: false, error: 'That name is too long.' };

  const schedule = await db.savedSchedule.create({
    data: { userId, termId, name: clean },
    select: { id: true },
  });
  return { ok: true, scheduleId: schedule.id };
}

export async function renameScheduleFor(
  userId: string,
  scheduleId: string,
  name: string,
): Promise<Result> {
  if (!(await owns(userId, scheduleId))) return { ok: false, error: NOT_YOURS };
  const clean = name.trim();
  if (!clean) return { ok: false, error: 'Give the schedule a name.' };

  await db.savedSchedule.update({ where: { id: scheduleId }, data: { name: clean } });
  return { ok: true };
}

export async function deleteScheduleFor(userId: string, scheduleId: string): Promise<Result> {
  if (!(await owns(userId, scheduleId))) return { ok: false, error: NOT_YOURS };
  // ScheduleSection and CalendarToken both cascade from SavedSchedule.
  await db.savedSchedule.delete({ where: { id: scheduleId } });
  return { ok: true };
}

export async function addSectionFor(
  userId: string,
  scheduleId: string,
  sectionId: string,
): Promise<Result> {
  if (!(await owns(userId, scheduleId))) return { ok: false, error: NOT_YOURS };

  // Idempotent: re-adding a section already present is a no-op, not an error.
  await db.scheduleSection.upsert({
    where: { scheduleId_sectionId: { scheduleId, sectionId } },
    create: { scheduleId, sectionId },
    update: {},
  });
  return { ok: true };
}

export async function removeSectionFor(
  userId: string,
  scheduleId: string,
  sectionId: string,
): Promise<Result> {
  if (!(await owns(userId, scheduleId))) return { ok: false, error: NOT_YOURS };
  await db.scheduleSection.deleteMany({ where: { scheduleId, sectionId } });
  return { ok: true };
}

export async function getOrCreateTokenFor(
  userId: string,
  scheduleId: string,
): Promise<TokenResult> {
  if (!(await owns(userId, scheduleId))) return { ok: false, error: NOT_YOURS };

  const existing = await db.calendarToken.findUnique({ where: { scheduleId } });
  if (existing) return { ok: true, token: existing.token };

  // 32 bytes: this token IS the capability for reading the schedule's calendar.
  const created = await db.calendarToken.create({
    data: { scheduleId, token: randomBytes(32).toString('hex') },
  });
  return { ok: true, token: created.token };
}

async function currentUserId(): Promise<string | null> {
  const session = await auth();
  return session?.user?.id ?? null;
}

export async function createSchedule(termId: string, name: string): Promise<CreateResult> {
  const userId = await currentUserId();
  if (!userId) return { ok: false, error: 'Sign in to build a schedule.' };
  const result = await createScheduleFor(userId, termId, name);
  if (result.ok) revalidatePath('/schedule');
  return result;
}

export async function renameSchedule(scheduleId: string, name: string): Promise<Result> {
  const userId = await currentUserId();
  if (!userId) return { ok: false, error: 'Sign in to manage schedules.' };
  const result = await renameScheduleFor(userId, scheduleId, name);
  if (result.ok) revalidatePath(`/schedule/${scheduleId}`);
  return result;
}

export async function deleteSchedule(scheduleId: string): Promise<Result> {
  const userId = await currentUserId();
  if (!userId) return { ok: false, error: 'Sign in to manage schedules.' };
  const result = await deleteScheduleFor(userId, scheduleId);
  if (result.ok) revalidatePath('/schedule');
  return result;
}

export async function addSection(scheduleId: string, sectionId: string): Promise<Result> {
  const userId = await currentUserId();
  if (!userId) return { ok: false, error: 'Sign in to build a schedule.' };
  const result = await addSectionFor(userId, scheduleId, sectionId);
  if (result.ok) revalidatePath(`/schedule/${scheduleId}`);
  return result;
}

export async function removeSection(scheduleId: string, sectionId: string): Promise<Result> {
  const userId = await currentUserId();
  if (!userId) return { ok: false, error: 'Sign in to build a schedule.' };
  const result = await removeSectionFor(userId, scheduleId, sectionId);
  if (result.ok) revalidatePath(`/schedule/${scheduleId}`);
  return result;
}

export async function getSubscribeUrl(scheduleId: string): Promise<TokenResult> {
  const userId = await currentUserId();
  if (!userId) return { ok: false, error: 'Sign in to subscribe.' };
  return getOrCreateTokenFor(userId, scheduleId);
}
