import { randomBytes } from 'node:crypto';
import { Resend } from 'resend';
import { db } from '@/lib/db';

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

/** What an emailed link is allowed to do. See VerificationToken in schema.prisma. */
export type TokenPurpose = 'verify' | 'reset' | 'mute';

const TTL_MS: Record<TokenPurpose, number> = {
  // A confirmation link is harmless if it sits in an inbox for a day.
  verify: 24 * 60 * 60 * 1000,
  // A reset link is a live key to the account, so it gets an hour.
  reset: 60 * 60 * 1000,
  // A mute link lives in an inbox for weeks before it is wanted.
  mute: 30 * 24 * 60 * 60 * 1000,
};

/**
 * Sends through Resend when RESEND_API_KEY is configured; otherwise falls
 * back to logging the message, so a teammate without their own Resend
 * account still has a working (if unsent) mail flow. Tests always take the
 * console path too, even if a real key is set in .env - VITEST is set by
 * the test runner itself, not something a caller can spoof - so running the
 * suite can never fire real email.
 *
 * A send failure is logged, not thrown: requestPasswordReset returns the
 * same { ok: true } whether or not the address has an account, so a
 * provider outage must not change that shape or crash the caller.
 *
 * This still prints reset links to the server log as a side effect of the
 * fallback path, which is one of the reasons tokens carry a purpose: a link
 * that leaks from there can only do the one thing it was issued for.
 *
 * Returns whether the message can be considered sent, so a caller like the
 * Canvas notify job can decide whether to mark its sent-log delivered or
 * leave it to retry. Existing callers ignore the return value.
 */
export async function sendMail(
  to: string,
  subject: string,
  body: string,
  html?: string,
): Promise<boolean> {
  if (!resend || process.env.VITEST) {
    console.log(`\n--- MAIL ---\nTo: ${to}\nSubject: ${subject}\n\n${body}\n------------\n`);
    return true;
  }

  const { error } = await resend.emails.send({
    from: process.env.MAIL_FROM ?? 'UBC Flow <onboarding@resend.dev>',
    to,
    subject,
    // Both parts, always. The plain text is what a screen reader and a
    // text-only client read, and a message carrying only an HTML part scores
    // worse with spam filters. The console path above logs the text for the
    // same reason: it is the readable one.
    text: body,
    ...(html ? { html } : {}),
  });
  if (error) {
    console.error('sendMail failed:', error);
    return false;
  }
  return true;
}

export async function createToken(userId: string, purpose: TokenPurpose): Promise<string> {
  const token = randomBytes(32).toString('hex');
  await db.verificationToken.create({
    data: { token, userId, purpose, expiresAt: new Date(Date.now() + TTL_MS[purpose]) },
  });
  return token;
}

/**
 * Redeem a token, but only for the purpose it was issued for.
 *
 * Callers must pass the purpose they expect. A token is deleted before its
 * expiry is checked, so a replay finds nothing either way - but a token issued
 * for a different purpose is left in place, because it is still valid for its
 * own flow and rejecting it here must not consume it.
 */
export async function consumeToken(
  token: string,
  purpose: TokenPurpose,
): Promise<{ ok: boolean; userId?: string }> {
  const row = await db.verificationToken.findUnique({ where: { token } });
  if (!row || row.purpose !== purpose) return { ok: false };

  await db.verificationToken.delete({ where: { token } });
  if (row.expiresAt < new Date()) return { ok: false };
  return { ok: true, userId: row.userId };
}

/**
 * Read a token without spending it, for a page that has to render on a GET.
 *
 * Same purpose and expiry rules as consumeToken, no delete. Inbound mail at
 * UBC goes through Microsoft Defender Safe Links, which fetches the URLs in a
 * message; a page that consumed its token on render would have the scanner
 * spend it before the student ever clicked. The page peeks, shows a form, and
 * the form's action consumes.
 */
export async function peekToken(
  token: string,
  purpose: TokenPurpose,
): Promise<{ ok: boolean; userId?: string }> {
  const row = await db.verificationToken.findUnique({ where: { token } });
  if (!row || row.purpose !== purpose || row.expiresAt < new Date()) return { ok: false };
  return { ok: true, userId: row.userId };
}

/** Drop every outstanding token of one purpose - used to retire superseded links. */
export async function revokeTokens(userId: string, purpose: TokenPurpose): Promise<void> {
  await db.verificationToken.deleteMany({ where: { userId, purpose } });
}

/** When the user last asked for a link of this purpose, for rate limiting. */
export async function lastTokenIssuedAt(
  userId: string,
  purpose: TokenPurpose,
): Promise<Date | null> {
  const row = await db.verificationToken.findFirst({
    where: { userId, purpose },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  });
  return row?.createdAt ?? null;
}

export function createVerificationToken(userId: string): Promise<string> {
  return createToken(userId, 'verify');
}

/** Confirms the address as a side effect - the only thing a verify link does. */
export async function consumeVerificationToken(
  token: string,
): Promise<{ ok: boolean; userId?: string }> {
  const result = await consumeToken(token, 'verify');
  if (!result.ok || !result.userId) return { ok: false };
  await db.user.update({ where: { id: result.userId }, data: { emailVerified: new Date() } });
  return result;
}
