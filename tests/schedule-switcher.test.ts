import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '@/lib/db';
import { listSwitchableSchedules } from '@/schedule/switcher';

const OWNER = 'zz-switcher-owner@example.com';

let ownerId: string;
let termA: { id: string; name: string };
let termB: { id: string; name: string };

beforeAll(async () => {
  await db.user.deleteMany({ where: { email: OWNER } });
  ownerId = (await db.user.create({ data: { email: OWNER } })).id;

  const terms = await db.term.findMany({ where: { campus: 'V' }, take: 2 });
  if (terms.length < 2) throw new Error('need two terms');
  [termA, termB] = terms;

  await db.savedSchedule.create({ data: { userId: ownerId, termId: termA.id, name: 'Plan A' } });
  await db.savedSchedule.create({ data: { userId: ownerId, termId: termB.id, name: 'Plan B' } });
});

afterAll(async () => {
  await db.savedSchedule.deleteMany({ where: { userId: ownerId } });
  await db.user.deleteMany({ where: { email: OWNER } });
});

describe('listSwitchableSchedules', () => {
  it('returns nothing for a signed-out visitor', async () => {
    expect(await listSwitchableSchedules(undefined, [termA, termB])).toEqual([]);
  });

  it('labels each schedule with its term name', async () => {
    const list = await listSwitchableSchedules(ownerId, [termA, termB]);
    expect(list).toHaveLength(2);
    expect(list.find((s) => s.name === 'Plan A')?.termName).toBe(termA.name);
    expect(list.find((s) => s.name === 'Plan B')?.termName).toBe(termB.name);
  });

  it('keeps a schedule whose term is no longer offered, rather than dropping it', async () => {
    // termB withheld: a passed term is filtered out of the builder's list, and
    // silently losing the schedule from the switcher would strand it.
    const list = await listSwitchableSchedules(ownerId, [termA]);
    expect(list).toHaveLength(2);
    expect(list.find((s) => s.name === 'Plan B')?.termName).toBe('Past term');
  });

  it('never lists another user\'s schedules', async () => {
    const stranger = await db.user.create({
      data: { email: 'zz-switcher-stranger@example.com' },
    });
    try {
      expect(await listSwitchableSchedules(stranger.id, [termA, termB])).toEqual([]);
    } finally {
      await db.user.delete({ where: { id: stranger.id } });
    }
  });
});
