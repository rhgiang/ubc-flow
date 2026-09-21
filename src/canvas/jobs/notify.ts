// src/canvas/jobs/notify.ts
import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { createToken, sendMail } from '@/lib/mail';
import { selectNotices, type DeadlineForNotice, type Notice } from '@/canvas/notices';
import { SITE, reminderEmail, welcomeEmail } from '@/canvas/emails';

const DAY = 24 * 3600_000;

async function muteUrl(userId: string): Promise<string> {
  return `${SITE}/reminders/${await createToken(userId, 'mute')}`;
}

/**
 * Runs AFTER syncFeedFor for the same student. Sends at most one email per
 * run per student. Every notice in that email is claimed in ReminderSent
 * before the send: two overlapping runs cannot both send, because the second
 * claim loses on the unique (deadlineId, notice). A claim whose send failed
 * keeps deliveredAt null and is retried while its window is still open.
 */
export async function notifyFor(userId: string, now: Date): Promise<{ sent: number }> {
  const [user, feed, prefs] = await Promise.all([
    db.user.findUnique({ where: { id: userId }, select: { email: true } }),
    db.canvasFeed.findUnique({ where: { userId }, select: { brokenAt: true, firstSyncedAt: true } }),
    db.reminderPreference.findUnique({ where: { userId } }),
  ]);
  if (!user || !feed || feed.brokenAt || !prefs) return { sent: 0 };

  const deadlines: DeadlineForNotice[] = await db.canvasDeadline.findMany({
    where: { userId },
    select: { id: true, title: true, courseName: true, dueAt: true, allDay: true, url: true, movedFrom: true, movedAt: true, removedAt: true, completedAt: true },
  });

  if (!feed.firstSyncedAt) {
    // A muted student is not welcomed. selectNotices guards the per-item path
    // but this branch sits above it, and a student who muted, disconnected and
    // reconnected gets a fresh feed row with firstSyncedAt null while
    // connectCanvasFeedFor deliberately preserves enabled: false. Stamp
    // anyway, so the welcome is spent rather than pending if they unmute.
    if (!prefs.enabled) {
      await db.canvasFeed.update({ where: { userId }, data: { firstSyncedAt: now } });
      return { sent: 0 };
    }
    // The welcome replaces every per-item reminder this run: a student who
    // connects with eight things due this week must not get eight emails.
    const upcoming = deadlines
      .filter((d) => !d.removedAt && d.dueAt > now && d.dueAt.getTime() - now.getTime() <= 14 * DAY)
      .sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime());
    const mail = welcomeEmail(upcoming, prefs, await muteUrl(userId));
    // Stamped only when the send actually worked. Stamping regardless spends
    // the welcome on a failed send and it is never retried, which is exactly
    // what happened on the first live run: Resend returned 403 because
    // MAIL_FROM was still the sandbox sender, and the welcome was gone. The
    // per-item path is built around this same retry guarantee through
    // ReminderSent; there is no reason the welcome is the one email allowed
    // to vanish. A send that keeps failing retries every run and holds the
    // per-item notices behind it, which is the honest outcome: mail is
    // broken, and no reminder would have been delivered either.
    if (await sendMail(user.email, mail.subject, mail.body, mail.html)) {
      await db.canvasFeed.update({ where: { userId }, data: { firstSyncedAt: now } });
    }
    return { sent: 0 };
  }

  // Claim first. Undelivered earlier claims are picked up again here too.
  const claimed: { rowId: string; notice: Notice }[] = [];
  for (const notice of selectNotices(deadlines, prefs, now)) {
    try {
      const row = await db.reminderSent.create({
        data: { userId, deadlineId: notice.deadline.id, notice: notice.key, claimedAt: now },
        select: { id: true },
      });
      claimed.push({ rowId: row.id, notice });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const existing = await db.reminderSent.findUnique({
          where: { deadlineId_notice: { deadlineId: notice.deadline.id, notice: notice.key } },
          select: { id: true, deliveredAt: true },
        });
        if (existing && existing.deliveredAt === null) claimed.push({ rowId: existing.id, notice });
        continue;
      }
      throw e;
    }
  }
  if (claimed.length === 0) return { sent: 0 };

  const mail = reminderEmail(claimed.map((c) => c.notice), await muteUrl(userId));
  const delivered = await sendMail(user.email, mail.subject, mail.body, mail.html);
  if (delivered) {
    await db.reminderSent.updateMany({ where: { id: { in: claimed.map((c) => c.rowId) } }, data: { deliveredAt: now } });
  }
  return { sent: delivered ? claimed.length : 0 };
}
