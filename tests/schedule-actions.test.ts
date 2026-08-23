import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '@/lib/db';
import {
  createScheduleFor,
  renameScheduleFor,
  deleteScheduleFor,
  addSectionFor,
  removeSectionFor,
  getOrCreateTokenFor,
  replaceScheduleSectionsFor,
} from '@/app/actions/schedule';

const OWNER = 'zz-sched-owner@example.com';
const STRANGER = 'zz-sched-stranger@example.com';

let ownerId: string;
let strangerId: string;
let termId: string;
let sectionId: string;
let scheduleId: string;
let otherTermSectionId: string;

beforeAll(async () => {
  await db.user.deleteMany({ where: { email: { in: [OWNER, STRANGER] } } });
  ownerId = (await db.user.create({ data: { email: OWNER } })).id;
  strangerId = (await db.user.create({ data: { email: STRANGER } })).id;

  const section = await db.section.findFirstOrThrow({ select: { id: true, termId: true } });
  sectionId = section.id;
  termId = section.termId;

  const otherSection = await db.section.findFirstOrThrow({
    where: { termId: { not: termId } },
    select: { id: true },
  });
  otherTermSectionId = otherSection.id;

  const created = await createScheduleFor(ownerId, termId, 'Plan A');
  if (!created.ok) throw new Error('setup failed');
  scheduleId = created.scheduleId;
});

afterAll(async () => {
  await db.savedSchedule.deleteMany({ where: { userId: { in: [ownerId, strangerId] } } });
  await db.user.deleteMany({ where: { email: { in: [OWNER, STRANGER] } } });
  await db.$disconnect();
});

describe('ownership', () => {
  it('lets the owner add a section', async () => {
    const r = await addSectionFor(ownerId, scheduleId, sectionId);
    expect(r.ok).toBe(true);
    expect(await db.scheduleSection.count({ where: { scheduleId } })).toBe(1);
  });

  it('REJECTS a stranger adding a section', async () => {
    const r = await addSectionFor(strangerId, scheduleId, sectionId);
    expect(r.ok).toBe(false);
    expect(await db.scheduleSection.count({ where: { scheduleId } })).toBe(1);
  });

  it('REJECTS a stranger removing a section', async () => {
    const r = await removeSectionFor(strangerId, scheduleId, sectionId);
    expect(r.ok).toBe(false);
    expect(await db.scheduleSection.count({ where: { scheduleId } })).toBe(1);
  });

  it('REJECTS a stranger renaming the schedule', async () => {
    const r = await renameScheduleFor(strangerId, scheduleId, 'Hacked');
    expect(r.ok).toBe(false);
    const s = await db.savedSchedule.findUniqueOrThrow({ where: { id: scheduleId } });
    expect(s.name).toBe('Plan A');
  });

  it('REJECTS a stranger deleting the schedule', async () => {
    const r = await deleteScheduleFor(strangerId, scheduleId);
    expect(r.ok).toBe(false);
    expect(await db.savedSchedule.count({ where: { id: scheduleId } })).toBe(1);
  });

  it('REJECTS a stranger minting a subscribe token', async () => {
    const r = await getOrCreateTokenFor(strangerId, scheduleId);
    expect(r.ok).toBe(false);
  });
});

describe('behaviour', () => {
  it('adding the same section twice is idempotent', async () => {
    await addSectionFor(ownerId, scheduleId, sectionId);
    expect(await db.scheduleSection.count({ where: { scheduleId } })).toBe(1);
  });

  it('returns a stable token across calls', async () => {
    const a = await getOrCreateTokenFor(ownerId, scheduleId);
    const b = await getOrCreateTokenFor(ownerId, scheduleId);
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) expect(a.token).toBe(b.token);
  });

  it('lets the owner remove a section', async () => {
    const r = await removeSectionFor(ownerId, scheduleId, sectionId);
    expect(r.ok).toBe(true);
    expect(await db.scheduleSection.count({ where: { scheduleId } })).toBe(0);
  });

  it('allows several schedules for the same term', async () => {
    const b = await createScheduleFor(ownerId, termId, 'Plan B');
    expect(b.ok).toBe(true);
    expect(await db.savedSchedule.count({ where: { userId: ownerId, termId } })).toBe(2);
  });

  it('deleting a schedule cascades its sections and token', async () => {
    const created = await createScheduleFor(ownerId, termId, 'Plan C');
    if (!created.ok) throw new Error('setup failed');
    await addSectionFor(ownerId, created.scheduleId, sectionId);
    await getOrCreateTokenFor(ownerId, created.scheduleId);

    await deleteScheduleFor(ownerId, created.scheduleId);

    expect(await db.scheduleSection.count({ where: { scheduleId: created.scheduleId } })).toBe(0);
    expect(await db.calendarToken.count({ where: { scheduleId: created.scheduleId } })).toBe(0);
  });
});

describe('replaceScheduleSectionsFor', () => {
  it('applies a buffered add, a rename, and a removal in one call', async () => {
    const created = await createScheduleFor(ownerId, termId, 'Buffer A');
    if (!created.ok) throw new Error(created.error);
    const id = created.scheduleId;

    const added = await replaceScheduleSectionsFor(ownerId, id, 'Buffer B', [sectionId], []);
    expect(added).toEqual({ ok: true });

    const afterAdd = await db.savedSchedule.findUniqueOrThrow({
      where: { id },
      include: { sections: true },
    });
    expect(afterAdd.name).toBe('Buffer B');
    expect(afterAdd.sections.map((s) => s.sectionId)).toEqual([sectionId]);

    const cleared = await replaceScheduleSectionsFor(ownerId, id, 'Buffer B', [], [sectionId]);
    expect(cleared).toEqual({ ok: true });

    const afterClear = await db.savedSchedule.findUniqueOrThrow({
      where: { id },
      include: { sections: true },
    });
    expect(afterClear.sections).toEqual([]);
  });

  it('is a no-op when the buffer matches what is stored', async () => {
    const created = await createScheduleFor(ownerId, termId, 'Buffer C');
    if (!created.ok) throw new Error(created.error);
    const id = created.scheduleId;

    await replaceScheduleSectionsFor(ownerId, id, 'Buffer C', [sectionId], []);
    const again = await replaceScheduleSectionsFor(ownerId, id, 'Buffer C', [sectionId], [sectionId]);
    expect(again).toEqual({ ok: true });

    const row = await db.savedSchedule.findUniqueOrThrow({
      where: { id },
      include: { sections: true },
    });
    expect(row.sections.map((s) => s.sectionId)).toEqual([sectionId]);
  });

  it("refuses a schedule that isn't yours and changes nothing", async () => {
    const created = await createScheduleFor(ownerId, termId, 'Buffer D');
    if (!created.ok) throw new Error(created.error);
    const id = created.scheduleId;

    const result = await replaceScheduleSectionsFor(strangerId, id, 'Hijacked', [sectionId], []);
    expect(result.ok).toBe(false);

    const row = await db.savedSchedule.findUniqueOrThrow({
      where: { id },
      include: { sections: true },
    });
    expect(row.name).toBe('Buffer D');
    expect(row.sections).toEqual([]);
  });

  it('rejects a blank name', async () => {
    const created = await createScheduleFor(ownerId, termId, 'Buffer E');
    if (!created.ok) throw new Error(created.error);

    const result = await replaceScheduleSectionsFor(ownerId, created.scheduleId, '   ', [], []);
    expect(result.ok).toBe(false);
  });

  it('saves a section that belongs to the schedule\'s own term', async () => {
    const created = await createScheduleFor(ownerId, termId, 'Cross-term OK');
    if (!created.ok) throw new Error(created.error);

    const result = await replaceScheduleSectionsFor(
      ownerId,
      created.scheduleId,
      'Cross-term OK',
      [sectionId],
      [],
    );
    expect(result).toEqual({ ok: true });

    const row = await db.savedSchedule.findUniqueOrThrow({
      where: { id: created.scheduleId },
      include: { sections: true },
    });
    expect(row.sections.map((s) => s.sectionId)).toEqual([sectionId]);
  });

  it('REJECTS a section from a different term and changes nothing', async () => {
    const created = await createScheduleFor(ownerId, termId, 'Cross-term Bad');
    if (!created.ok) throw new Error(created.error);
    const id = created.scheduleId;

    const result = await replaceScheduleSectionsFor(ownerId, id, 'Renamed', [otherTermSectionId], []);
    expect(result.ok).toBe(false);

    const row = await db.savedSchedule.findUniqueOrThrow({
      where: { id },
      include: { sections: true },
    });
    expect(row.name).toBe('Cross-term Bad');
    expect(row.sections).toEqual([]);
  });
});

describe('replaceScheduleSectionsFor staleness', () => {
  it('saves when the stored set matches what the caller loaded with', async () => {
    const created = await createScheduleFor(ownerId, termId, 'Stale A');
    if (!created.ok) throw new Error(created.error);

    const result = await replaceScheduleSectionsFor(ownerId, created.scheduleId, 'Stale A', [sectionId], []);
    expect(result).toEqual({ ok: true });
  });

  it('refuses when the schedule changed elsewhere since it was loaded', async () => {
    const created = await createScheduleFor(ownerId, termId, 'Stale B');
    if (!created.ok) throw new Error(created.error);
    const id = created.scheduleId;

    // Someone else (e.g. the course page) adds a section after the builder loaded.
    await addSectionFor(ownerId, id, sectionId);

    // The builder still believes the schedule was empty.
    const result = await replaceScheduleSectionsFor(ownerId, id, 'Stale B', [], []);
    expect(result.ok).toBe(false);

    // And the concurrent add must survive.
    const row = await db.savedSchedule.findUniqueOrThrow({
      where: { id },
      include: { sections: true },
    });
    expect(row.sections.map((s) => s.sectionId)).toEqual([sectionId]);
  });

  it('ignores ordering when comparing the baseline', async () => {
    const second = await db.section.findFirstOrThrow({
      where: { termId, id: { not: sectionId } },
      select: { id: true },
    });
    const created = await createScheduleFor(ownerId, termId, 'Stale C');
    if (!created.ok) throw new Error(created.error);
    const id = created.scheduleId;

    await replaceScheduleSectionsFor(ownerId, id, 'Stale C', [sectionId, second.id], []);
    // Same set, reversed order — must be accepted.
    const result = await replaceScheduleSectionsFor(ownerId, id, 'Stale C', [sectionId], [second.id, sectionId]);
    expect(result).toEqual({ ok: true });
  });

  it('accepts a second save that follows the first without a reload', async () => {
    const created = await createScheduleFor(ownerId, termId, 'Twice');
    if (!created.ok) throw new Error(created.error);
    const id = created.scheduleId;

    const first = await replaceScheduleSectionsFor(ownerId, id, 'Twice', [sectionId], []);
    expect(first).toEqual({ ok: true });

    // The client now knows its own save is the baseline.
    const second = await replaceScheduleSectionsFor(ownerId, id, 'Twice', [], [sectionId]);
    expect(second).toEqual({ ok: true });
  });
});
