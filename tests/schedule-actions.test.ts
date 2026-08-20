import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '@/lib/db';
import {
  createScheduleFor,
  renameScheduleFor,
  deleteScheduleFor,
  addSectionFor,
  removeSectionFor,
  getOrCreateTokenFor,
} from '@/app/actions/schedule';

const OWNER = 'zz-sched-owner@example.com';
const STRANGER = 'zz-sched-stranger@example.com';

let ownerId: string;
let strangerId: string;
let termId: string;
let sectionId: string;
let scheduleId: string;

beforeAll(async () => {
  await db.user.deleteMany({ where: { email: { in: [OWNER, STRANGER] } } });
  ownerId = (await db.user.create({ data: { email: OWNER } })).id;
  strangerId = (await db.user.create({ data: { email: STRANGER } })).id;

  const section = await db.section.findFirstOrThrow({ select: { id: true, termId: true } });
  sectionId = section.id;
  termId = section.termId;

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
