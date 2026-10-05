import { db } from '@/lib/db';

/**
 * How often one KIND of error is allowed to send an email.
 *
 * The cooldown used to be a module-level timestamp, which is per server
 * instance. That reads as fifteen minutes and behaves as nothing once there
 * is more than one instance: errors arriving across five deployments at once
 * each met a fresh timer, so twelve errors in a day sent about twelve emails.
 * Sharing it through the database is the only way several instances can agree
 * on when the last one went out.
 */
export const ALERT_COOLDOWN_MS = 15 * 60 * 1000;

export type AlertClaim =
  /** Send it, and say how many of this error it is standing in for. */
  | { send: true; suppressed: number }
  /** Someone already sent one recently. This occurrence has been counted. */
  | { send: false };

/**
 * Decides whether this error gets an email, and counts the ones that do not.
 *
 * Keyed per error rather than globally: a single noisy error must not mute a
 * new and different one, which is what a global cooldown would do, and which
 * would make the alerting worse than useless at exactly the moment it matters.
 *
 * ponytail: read-then-write, not an atomic claim. Two instances hitting the
 * same error in the same millisecond can both decide to send, so the ceiling
 * is "very occasionally two emails instead of one" - which is the failure we
 * can afford, against the twelve-a-day we are fixing. A single-statement
 * upsert with a CASE on lastSentAt is the upgrade if it ever matters.
 */
export async function claimAlert(key: string, now: Date): Promise<AlertClaim> {
  const cutoff = new Date(now.getTime() - ALERT_COOLDOWN_MS);
  const row = await db.errorAlert.findUnique({
    where: { key },
    select: { lastSentAt: true, suppressed: true },
  });

  if (row && row.lastSentAt > cutoff) {
    // Still inside the window. Count it so the next email can say how many
    // it speaks for, rather than leaving an inbox to be counted by hand.
    await db.errorAlert.update({ where: { key }, data: { suppressed: { increment: 1 } } });
    return { send: false };
  }

  await db.errorAlert.upsert({
    where: { key },
    create: { key, lastSentAt: now, suppressed: 0 },
    update: { lastSentAt: now, suppressed: 0 },
  });
  return { send: true, suppressed: row?.suppressed ?? 0 };
}
