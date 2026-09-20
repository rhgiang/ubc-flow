import { describe, it, expect, vi } from 'vitest';

vi.mock('@/canvas/jobs/sync', () => ({ syncFeedFor: vi.fn(async (id: string) => (id === 'broken-one' ? 'broken' : 'ok')) }));
vi.mock('@/canvas/jobs/notify', () => ({ notifyFor: vi.fn(async () => ({ sent: 1 })) }));
const mails: string[] = [];
vi.mock('@/lib/mail', () => ({ sendMail: vi.fn(async (_to: string, subject: string) => { mails.push(subject); return true; }) }));
vi.mock('@/lib/db', () => ({
  db: {
    canvasFeed: {
      findMany: vi.fn(async () => [
        { userId: 'fine-one', user: { email: 'a@x' }, brokenAt: null },
        { userId: 'broken-one', user: { email: 'b@x' }, brokenAt: null },
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
});
