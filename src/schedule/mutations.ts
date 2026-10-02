// src/schedule/mutations.ts  (plain module, NOT 'use server')
/**
 * Every schedule write, taking the acting userId as an argument.
 *
 * These deliberately do NOT live in src/app/actions/schedule.ts. Each export
 * of a 'use server' file is a callable HTTP endpoint the moment that module is
 * reachable from the server graph, and src/app/course/[code]/page.tsx imports
 * it into a Server Component, where nothing can be tree-shaken. So every
 * export there was registered and dispatchable, including functions whose
 * first argument is the user they act as: an endpoint that trusts a
 * caller-supplied userId is a hole, and these are eight of them.
 *
 * Next's origin check was the only thing in the way, and it stops a browser
 * doing it cross-site, not a script that simply sets the header. Measured
 * against the dev server: a forged origin is refused, a correct one reaches
 * application code with a 200. getEnrolledTokenFor was the worst of them,
 * because it cannot have an ownership check: the userId it trusts IS the
 * identity, so it would mint a permanent calendar token for whoever you named.
 *
 * Moving them here makes the rule structural instead of a comment. The thin
 * session-reading wrappers stay in the action file and are the only way in.
 * src/canvas/connect.ts is the same split, for the same reason.
 */
import { randomBytes } from 'node:crypto';
import { db } from '@/lib/db';
import { isPlannableTerm } from '@/schedule/terms';
import { diffSections } from '@/schedule/buffer';
import { sanitizeSectionLocations, type SectionLocation } from '@/schedule/locations';

export type Result = { ok: true } | { ok: false; error: string };
export type CreateResult = { ok: true; scheduleId: string } | { ok: false; error: string };
export type TokenResult = { ok: true; token: string } | { ok: false; error: string };

export const NOT_YOURS = 'That schedule does not belong to you.';

/** Ownership check - every mutation goes through this first. */
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

  const term = await db.term.findUnique({
    where: { id: termId },
    select: { year: true, session: true, termNumber: true },
  });
  if (!term || !isPlannableTerm(term)) {
    return { ok: false, error: 'That term is not available to plan a schedule for.' };
  }

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

/** Session-free half of getEnrolledSubscribeUrl (see getOrCreateTokenFor). */
export async function getEnrolledTokenFor(
  userId: string,
  termId: string,
): Promise<TokenResult> {
  const existing = await db.enrollmentCalendarToken.findUnique({
    where: { userId_termId: { userId, termId } },
  });
  if (existing) return { ok: true, token: existing.token };

  // 32 bytes: this token IS the capability for reading the term's calendar.
  const created = await db.enrollmentCalendarToken.create({
    data: { userId, termId, token: randomBytes(32).toString('hex') },
  });
  return { ok: true, token: created.token };
}

/**
 * Commits a whole buffered edit: the name plus the exact set of sections the
 * builder is holding. The builder buffers rather than writing through on every
 * add/remove (spec §3.1), so this is the one write its Save button makes.
 */
export async function replaceScheduleSectionsFor(
  userId: string,
  scheduleId: string,
  name: string,
  sectionIds: string[],
  expectedSectionIds: string[],
  locations?: SectionLocation[],
): Promise<Result> {
  if (!(await owns(userId, scheduleId))) return { ok: false, error: NOT_YOURS };
  const clean = name.trim();
  if (!clean) return { ok: false, error: 'Give the schedule a name.' };
  if (clean.length > 80) return { ok: false, error: 'That name is too long.' };

  const existing = await db.scheduleSection.findMany({
    where: { scheduleId },
    select: { sectionId: true },
  });

  const storedIds = existing.map((s) => s.sectionId);
  const expected = new Set(expectedSectionIds);
  const stored = new Set(storedIds);
  const unchanged =
    expected.size === stored.size && [...stored].every((id) => expected.has(id));
  if (!unchanged) {
    return {
      ok: false,
      error: 'This schedule changed somewhere else. Reload the page before saving.',
    };
  }

  const ids = [...new Set(sectionIds)];
  if (ids.length > 0) {
    const { termId } = await db.savedSchedule.findUniqueOrThrow({
      where: { id: scheduleId },
      select: { termId: true },
    });
    const inTerm = await db.section.count({ where: { id: { in: ids }, termId } });
    if (inTerm !== ids.length) {
      return { ok: false, error: 'Some sections are not offered in this term.' };
    }
  }

  const { added, removed } = diffSections(existing.map((s) => s.sectionId), sectionIds);

  const places = new Map(
    sanitizeSectionLocations(locations, ids).map((l) => [l.sectionId, l]),
  );
  // Rows that survive this save still get their location rewritten: a student
  // who re-imports their export onto an existing schedule is telling us where
  // the class moved to, and a section that lost its room should lose it here.
  //
  // Only when the caller actually sent locations, though. Omitting them means
  // "I have nothing to say about rooms" - a caller that saved a name change
  // must not wipe every room in the schedule on its way past.
  const kept = locations === undefined ? [] : ids.filter((id) => !added.includes(id));

  // One transaction: a half-applied Save would leave the student looking at a
  // schedule that is neither what they had nor what they asked for.
  await db.$transaction([
    db.savedSchedule.update({ where: { id: scheduleId }, data: { name: clean } }),
    ...(removed.length
      ? [db.scheduleSection.deleteMany({ where: { scheduleId, sectionId: { in: removed } } })]
      : []),
    ...(added.length
      ? [
          db.scheduleSection.createMany({
            data: added.map((sectionId) => ({
              scheduleId,
              sectionId,
              building: places.get(sectionId)?.building ?? null,
              room: places.get(sectionId)?.room ?? null,
            })),
            skipDuplicates: true,
          }),
        ]
      : []),
    ...kept.map((sectionId) =>
      db.scheduleSection.updateMany({
        where: { scheduleId, sectionId },
        data: {
          building: places.get(sectionId)?.building ?? null,
          room: places.get(sectionId)?.room ?? null,
        },
      }),
    ),
  ]);
  return { ok: true };
}
