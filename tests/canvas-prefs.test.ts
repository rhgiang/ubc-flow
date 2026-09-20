import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '@/lib/db';
import { updateReminderPreferencesFor, LEAD_CHOICES } from '@/canvas/prefs';

const E = 'zz-canvas-prefs@example.com';
let userId: string;
beforeAll(async () => {
  await db.user.deleteMany({ where: { email: E } });
  userId = (await db.user.create({ data: { email: E } })).id;
  await db.reminderPreference.create({ data: { userId } });
});
afterAll(async () => {
  await db.user.deleteMany({ where: { email: E } });
  await db.$disconnect();
});

describe('updateReminderPreferencesFor', () => {
  it('stores chosen leads and mutes, deduplicated and sorted longest first', async () => {
    const r = await updateReminderPreferencesFor(userId, { leadHours: [24, 168, 24], mutedCourses: ['MATH 200', 'MATH 200'] });
    expect(r).toEqual({ ok: true });
    const p = await db.reminderPreference.findUniqueOrThrow({ where: { userId } });
    expect(p.leadHours).toEqual([168, 24]);
    expect(p.mutedCourses).toEqual(['MATH 200']);
  });

  // The cron runs every 4 hours; a 1-hour lead is a promise it cannot keep.
  it('rejects a lead the job cannot honour', async () => {
    const r = await updateReminderPreferencesFor(userId, { leadHours: [1], mutedCourses: [] });
    expect(r.ok).toBe(false);
    expect(LEAD_CHOICES).not.toContain(1);
  });

  it('rejects an empty lead list rather than silently disabling reminders', async () => {
    expect((await updateReminderPreferencesFor(userId, { leadHours: [], mutedCourses: [] })).ok).toBe(false);
  });

  it('caps the mute list', async () => {
    const many = Array.from({ length: 101 }, (_, i) => `C ${i}`);
    expect((await updateReminderPreferencesFor(userId, { leadHours: [24], mutedCourses: many })).ok).toBe(false);
  });
});
