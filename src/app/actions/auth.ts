'use server';

import { db } from '@/lib/db';
import { hashPassword } from '@/lib/hash';
import { createVerificationToken, lastTokenIssuedAt, revokeTokens, sendMail } from '@/lib/mail';
import { verifyEmail } from '@/lib/account-emails';

const MIN_PASSWORD = 10;

/**
 * A per-email cooldown would not help here: the quota-burning attack varies
 * the email on every request, and each new account fires a real Resend send
 * against a 100-a-day free tier. A global ceiling is blunt, but a day-old
 * student site does not legitimately sign up faster than this, and the error
 * says when to come back rather than pretending the address is bad.
 */
const MAX_SIGNUPS_PER_HOUR = 30;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function registerUser(
  email: string,
  password: string,
): Promise<{ ok: true; userId: string } | { ok: false; error: string }> {
  const normalized = email.trim().toLowerCase();

  // Deliberately NOT domain-restricted: email is an account identifier, not
  // proof of studenthood. The Workday upload is what proves that.
  if (!EMAIL_RE.test(normalized)) return { ok: false, error: 'Enter a valid email address.' };
  if (password.length < MIN_PASSWORD) {
    return { ok: false, error: `Password must be at least ${MIN_PASSWORD} characters.` };
  }

  const existing = await db.user.findUnique({ where: { email: normalized } });
  if (existing) return { ok: false, error: 'An account with that email already exists.' };

  const recentSignups = await db.user.count({
    where: { createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) } },
  });
  if (recentSignups >= MAX_SIGNUPS_PER_HOUR) {
    return { ok: false, error: 'Too many new accounts right now. Try again in an hour.' };
  }

  const user = await db.user.create({
    data: { email: normalized, passwordHash: await hashPassword(password) },
  });

  const token = await createVerificationToken(user.id);
  const link = verifyLink(token);
  const mail = verifyEmail(link);
  await sendMail(normalized, mail.subject, mail.body, mail.html);

  return { ok: true, userId: user.id };
}

/** One verification email a minute per account, matching password reset. */
const RESEND_COOLDOWN_MS = 60 * 1000;

function verifyLink(token: string): string {
  return `${process.env.NEXTAUTH_URL ?? 'http://localhost:3000'}/verify?token=${token}`;
}

/**
 * Send the confirmation link again.
 *
 * Sign-in refuses an unverified account and gives no hint why, because saying
 * so would confirm the address has an account. This is the way back, and it
 * has to be offered to everyone rather than surfaced only to people who need
 * it, for exactly the same reason.
 *
 * Returns the same value whether or not the address has an account, whether
 * or not it is already verified, and whether or not the cooldown swallowed
 * the request. requestPasswordReset is built the same way and for the same
 * reason; see its note.
 */
export async function resendVerification(email: string): Promise<{ ok: true }> {
  const normalized = email.trim().toLowerCase();
  if (!EMAIL_RE.test(normalized)) return { ok: true };

  const user = await db.user.findUnique({
    where: { email: normalized },
    select: { id: true, emailVerified: true },
  });

  if (user && !user.emailVerified) {
    const last = await lastTokenIssuedAt(user.id, 'verify');
    if (!last || Date.now() - last.getTime() >= RESEND_COOLDOWN_MS) {
      // Retire the earlier link so the newest email is the only one that
      // works, matching the reset flow.
      await revokeTokens(user.id, 'verify');
      const mail = verifyEmail(verifyLink(await createVerificationToken(user.id)));
      await sendMail(normalized, mail.subject, mail.body, mail.html);
    }
  }

  return { ok: true };
}
