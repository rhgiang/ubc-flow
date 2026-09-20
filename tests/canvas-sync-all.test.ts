import { describe, it, expect, vi } from 'vitest';

vi.mock('@/canvas/jobs/sync', () => ({ syncFeedFor: vi.fn(async (id: string) => (id === 'broken-one' ? 'broken' : 'ok')) }));
vi.mock('@/canvas/jobs/notify', () => ({ notifyFor: vi.fn(async () => ({ sent: 1 })) }));
const mails: string[] = [];
vi.mock('@/lib/mail', () => ({ sendMail: vi.fn(async (_to: string, subject: string) => { mails.push(subject); return true; }) }));
const brokenPrefs = { enabled: true };
vi.mock('@/lib/db', () => ({
  db: {
    canvasFeed: {
      findMany: vi.fn(async () => [
        { userId: 'fine-one', user: { email: 'a@x', reminderPreference: { enabled: true } }, brokenAt: null },
        { userId: 'broken-one', user: { email: 'b@x', reminderPreference: brokenPrefs }, brokenAt: null },
      ]),
    },
  },
}));
process.env.FEED_ENCRYPTION_KEY ??= '00'.repeat(31) + '01';

import { syncAllFeeds } from '@/canvas/jobs/sync-all';
import { notifyFor } from '@/canvas/jobs/notify';

describe('syncAllFeeds', () => {
  it('syncs every unbroken feed, notifies the healthy ones, and emails a newly broken one exactly once', async () => {
    const r = await syncAllFeeds(new Date('2026-10-24T15:00:00Z'));
    expect(r).toMatchObject({ feeds: 2, ok: 1, broken: 1, notices: 1 });
    expect(notifyFor).toHaveBeenCalledTimes(1);
    expect(notifyFor).toHaveBeenCalledWith('fine-one', expect.any(Date));
    expect(mails).toEqual(['Your Canvas feed stopped answering']);
  });

  it('sends no reconnect email to a student who turned reminders off', async () => {
    mails.length = 0;
    brokenPrefs.enabled = false;
    try {
      await syncAllFeeds(new Date('2026-10-24T15:00:00Z'));
      expect(mails).toEqual([]);
    } finally {
      brokenPrefs.enabled = true;
    }
  });

  it('refuses to start when RESEND_API_KEY is missing, rather than logging every email', async () => {
    const key = process.env.RESEND_API_KEY;
    const vitest = process.env.VITEST;
    delete process.env.RESEND_API_KEY;
    delete process.env.VITEST; // the job only allows the log fallback under the test runner
    try {
      await expect(syncAllFeeds(new Date('2026-10-24T15:00:00Z'))).rejects.toThrow(/RESEND_API_KEY/);
    } finally {
      if (key !== undefined) process.env.RESEND_API_KEY = key;
      if (vitest !== undefined) process.env.VITEST = vitest;
    }
  });
});
