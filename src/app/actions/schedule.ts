'use server';

import { randomBytes } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { auth } from '@/lib/auth';
import { isPlannableTerm } from '@/schedule/terms';
import { searchSectionsForTerm, type SectionHit } from '@/lib/search';
import { diffSections } from '@/schedule/buffer';
import { findMissingCompanions, type MissingCompanions } from '@/schedule/companions';
import { sanitizeSectionLocations, type SectionLocation } from '@/schedule/locations';

type Result = { ok: true } | { ok: false; error: string };
type CreateResult = { ok: true; scheduleId: string } | { ok: false; error: string };
type TokenResult = { ok: true; token: string } | { ok: false; error: string };
// needsAuth distinguishes "you're not signed in" from a validation error, so
// the guest schedule builder knows to prompt sign-in rather than just show
// the message inline.
type SaveResult =
  | { ok: true; scheduleId: string }
  | { ok: false; error: string; needsAuth?: true };

const NOT_YOURS = 'That schedule does not belong to you.';

/**
 * Which chosen courses still lack a companion section (lab, tutorial,
 * discussion, seminar or the lecture itself) among what they offer this term.
 * Read-only over public catalogue data, so no auth — the builder calls it at
 * save time for guests and signed-in students alike.
 */
export async function missingCompanionSections(
  termId: string,
  sectionIds: string[],
): Promise<MissingCompanions[]> {
  if (sectionIds.length === 0) return [];
  const chosen = await db.section.findMany({
    where: { id: { in: sectionIds } },
    select: {
      activity: true,
      courseId: true,
      course: { select: { number: true, subject: { select: { code: true } } } },
    },
  });
  if (chosen.length === 0) return [];
  const codeByCourse = new Map(
    chosen.map((s) => [s.courseId, `${s.course.subject.code} ${s.course.number}`]),
  );
  const offered = await db.section.findMany({
    where: { courseId: { in: [...codeByCourse.keys()] }, termId },
    select: { activity: true, courseId: true },
  });
  return findMissingCompanions(
    offered.map((s) => ({ code: codeByCourse.get(s.courseId)!, activity: s.activity })),
    chosen.map((s) => ({ code: codeByCourse.get(s.courseId)!, activity: s.activity })),
  );
}

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

/**
 * Creates the schedule and all of its sections in one call — the guest
 * builder's save step, where sections were only ever held in client state
 * (never persisted per-add the way the logged-in-only /schedule/[id] editor
 * does), so there's one write instead of N.
 */
async function createScheduleWithSectionsFor(
  userId: string,
  termId: string,
  name: string,
  sectionIds: string[],
  locations?: SectionLocation[],
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

  const ids = [...new Set(sectionIds)];
  if (ids.length > 0) {
    const inTerm = await db.section.count({ where: { id: { in: ids }, termId } });
    if (inTerm !== ids.length) {
      return { ok: false, error: 'Some sections are not offered in this term.' };
    }
  }

  // Rooms come from the student's own Workday import and exist nowhere else,
  // so they are saved with the sections rather than looked up later.
  const places = new Map(
    sanitizeSectionLocations(locations, ids).map((l) => [l.sectionId, l]),
  );

  const schedule = await db.savedSchedule.create({
    data: {
      userId,
      termId,
      name: clean,
      sections: {
        create: ids.map((sectionId) => ({
          sectionId,
          building: places.get(sectionId)?.building ?? null,
          room: places.get(sectionId)?.room ?? null,
        })),
      },
    },
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

async function currentUserId(): Promise<string | null> {
  const session = await auth();
  return session?.user?.id ?? null;
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

export async function getSubscribeUrl(scheduleId: string): Promise<TokenResult> {
  const userId = await currentUserId();
  if (!userId) return { ok: false, error: 'Sign in to subscribe.' };
  return getOrCreateTokenFor(userId, scheduleId);
}

/**
 * Turn read-only web sharing on for a schedule, returning the token.
 *
 * Minted on demand and kept once minted, so re-opening the share control hands
 * back the same link rather than quietly invalidating one already sent to
 * someone. Ownership is enforced by the updateMany filter: a schedule that is
 * not yours matches nothing and reports the same "not found" as one that does
 * not exist, which keeps the two indistinguishable to a prober.
 */
export async function enableScheduleSharing(scheduleId: string): Promise<TokenResult> {
  const userId = await currentUserId();
  if (!userId) return { ok: false, error: 'Sign in to share a schedule.' };

  const existing = await db.savedSchedule.findFirst({
    where: { id: scheduleId, userId },
    select: { shareToken: true },
  });
  if (!existing) return { ok: false, error: 'That schedule no longer exists.' };
  if (existing.shareToken) return { ok: true, token: existing.shareToken };

  const token = randomBytes(32).toString('hex');
  await db.savedSchedule.updateMany({ where: { id: scheduleId, userId }, data: { shareToken: token } });
  return { ok: true, token };
}

/**
 * Stop sharing. The link dies immediately and a new one is minted next time —
 * the old URL is not recoverable, which is the point of revoking it.
 *
 * Deliberately does not touch CalendarToken: someone may have this schedule
 * subscribed in their calendar app, and "stop showing the web page" should not
 * silently break that.
 */
export async function disableScheduleSharing(scheduleId: string): Promise<Result> {
  const userId = await currentUserId();
  if (!userId) return { ok: false, error: 'Sign in to manage sharing.' };

  const done = await db.savedSchedule.updateMany({
    where: { id: scheduleId, userId },
    data: { shareToken: null },
  });
  if (done.count === 0) return { ok: false, error: 'That schedule no longer exists.' };
  return { ok: true };
}

/** The enrollment counterpart to enableScheduleSharing — one link per term. */
export async function enableEnrollmentSharing(termId: string): Promise<TokenResult> {
  const userId = await currentUserId();
  if (!userId) return { ok: false, error: 'Sign in to share your calendar.' };

  const existing = await db.enrollmentShareToken.findUnique({
    where: { userId_termId: { userId, termId } },
  });
  if (existing) return { ok: true, token: existing.token };

  const created = await db.enrollmentShareToken.create({
    data: { userId, termId, token: randomBytes(32).toString('hex') },
  });
  return { ok: true, token: created.token };
}

/**
 * Stop sharing a term's calendar. Deleting the row kills the URL for good —
 * enabling again mints a fresh token — and, as with schedules, deliberately
 * leaves the subscribed ICS feed untouched. Idempotent: revoking a link that
 * is already gone is still "gone".
 */
export async function disableEnrollmentSharing(termId: string): Promise<Result> {
  const userId = await currentUserId();
  if (!userId) return { ok: false, error: 'Sign in to manage sharing.' };

  await db.enrollmentShareToken.deleteMany({ where: { userId, termId } });
  return { ok: true };
}

/**
 * Subscription capability for the Workday-imported courses in one term — the
 * enrollment counterpart to getSubscribeUrl. Minted on first use, then stable,
 * so a re-upload updates what the same subscribed URL serves.
 */
export async function getEnrolledSubscribeUrl(termId: string): Promise<TokenResult> {
  const userId = await currentUserId();
  if (!userId) return { ok: false, error: 'Sign in to subscribe.' };
  return getEnrolledTokenFor(userId, termId);
}

/** The guest schedule builder's search box — term-scoped section lookup, callable directly from a client component. */
export async function searchSections(query: string, termId: string): Promise<SectionHit[]> {
  return searchSectionsForTerm(query, termId);
}

/** Save step for a schedule built up entirely in client state (no account needed until now). */
export async function saveGuestSchedule(
  termId: string,
  name: string,
  sectionIds: string[],
  locations?: SectionLocation[],
): Promise<SaveResult> {
  const userId = await currentUserId();
  if (!userId) return { ok: false, error: 'Sign in to save your schedule.', needsAuth: true };
  const result = await createScheduleWithSectionsFor(userId, termId, name, sectionIds, locations);
  if (result.ok) revalidatePath('/schedule');
  return result;
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
  // "I have nothing to say about rooms" — a caller that saved a name change
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

/** Save button for an already-saved schedule. */
export async function replaceScheduleSections(
  scheduleId: string,
  name: string,
  sectionIds: string[],
  expectedSectionIds: string[],
  locations?: SectionLocation[],
): Promise<Result> {
  const userId = await currentUserId();
  if (!userId) return { ok: false, error: 'Sign in to save your schedule.' };
  const result = await replaceScheduleSectionsFor(
    userId,
    scheduleId,
    name,
    sectionIds,
    expectedSectionIds,
    locations,
  );
  if (result.ok) {
    revalidatePath('/schedule');
    revalidatePath(`/schedule/${scheduleId}`);
  }
  return result;
}
