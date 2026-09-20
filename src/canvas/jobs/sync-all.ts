import { db } from '@/lib/db';
import { sendMail } from '@/lib/mail';
import { assertFeedKey } from '@/canvas/crypto';
import { reconnectEmail } from '@/canvas/emails';
import { syncFeedFor } from '@/canvas/jobs/sync';
import { notifyFor } from '@/canvas/jobs/notify';

const SITE = process.env.NEXTAUTH_URL ?? 'https://ubcflow.com';

/** One pass over every connected, unbroken feed. Feeds are independent: a
 *  failure on one is logged and the loop continues, so one dead feed cannot
 *  stop everyone else's reminders. Nothing here logs a URL. */
export async function syncAllFeeds(now = new Date()) {
  assertFeedKey();
  const feeds = await db.canvasFeed.findMany({
    where: { brokenAt: null },
    select: { userId: true, brokenAt: true, user: { select: { email: true } } },
  });
  const counts = { feeds: feeds.length, ok: 0, broken: 0, transient: 0, notices: 0 };

  for (const feed of feeds) {
    try {
      const outcome = await syncFeedFor(feed.userId, now);
      if (outcome === 'ok') {
        counts.ok += 1;
        counts.notices += (await notifyFor(feed.userId, now)).sent;
      } else if (outcome === 'broken') {
        counts.broken += 1;
        // Sent from here, once: brokenAt was null when this loop started.
        const mail = reconnectEmail(`${SITE}/onboarding`);
        await sendMail(feed.user.email, mail.subject, mail.body);
      } else if (outcome === 'transient') {
        counts.transient += 1;
      }
    } catch (e) {
      console.error('canvas sync failed for one user:', e instanceof Error ? e.message : e);
    }
  }
  console.log(`canvas sync: ${JSON.stringify(counts)}`);
  return counts;
}
