// tests/alert-cooldown.test.ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { db } from '@/lib/db';
import { ALERT_COOLDOWN_MS, claimAlert } from '@/lib/alert-cooldown';

const KEY = 'zz-test@E80';
const OTHER = 'zz-test-other@E99';
const T0 = new Date('2026-10-05T12:00:00.000Z');
const later = (ms: number) => new Date(T0.getTime() + ms);

beforeEach(async () => {
  await db.errorAlert.deleteMany({ where: { key: { in: [KEY, OTHER] } } });
});
afterAll(async () => {
  await db.errorAlert.deleteMany({ where: { key: { in: [KEY, OTHER] } } });
  await db.$disconnect();
});

describe('claimAlert', () => {
  it('sends the first one it has ever seen', async () => {
    expect(await claimAlert(KEY, T0)).toEqual({ send: true, suppressed: 0 });
  });

  it('holds everything inside the window', async () => {
    await claimAlert(KEY, T0);
    expect(await claimAlert(KEY, later(60_000))).toEqual({ send: false });
    expect(await claimAlert(KEY, later(ALERT_COOLDOWN_MS - 1))).toEqual({ send: false });
  });

  it('sends again once the window is past, saying how many it stands in for', async () => {
    await claimAlert(KEY, T0);
    await claimAlert(KEY, later(60_000));
    await claimAlert(KEY, later(120_000));
    // Two were held back while the window was open; the next email says so.
    expect(await claimAlert(KEY, later(ALERT_COOLDOWN_MS + 1))).toEqual({ send: true, suppressed: 2 });
  });

  it('starts counting again after it has reported, not from zero errors', async () => {
    await claimAlert(KEY, T0);
    await claimAlert(KEY, later(60_000));
    await claimAlert(KEY, later(ALERT_COOLDOWN_MS + 1)); // reports the 1, resets
    expect(await claimAlert(KEY, later(2 * ALERT_COOLDOWN_MS + 2))).toEqual({ send: true, suppressed: 0 });
  });

  it('does not let a noisy error mute a different one', async () => {
    // The whole reason the cooldown is per key. A global one would make the
    // alerting worst exactly when something new starts going wrong.
    await claimAlert(KEY, T0);
    expect(await claimAlert(OTHER, later(1000))).toEqual({ send: true, suppressed: 0 });
  });

  it('is shared, not per process: a second caller sees the first send', async () => {
    // The bug this replaces. Each server instance kept its own timestamp, so
    // five deployments meant five emails for one error.
    await claimAlert(KEY, T0);
    const row = await db.errorAlert.findUniqueOrThrow({ where: { key: KEY } });
    expect(row.lastSentAt.toISOString()).toBe(T0.toISOString());
    expect(await claimAlert(KEY, later(1000))).toEqual({ send: false });
  });
});
