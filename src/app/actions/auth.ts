'use server';

import { db } from '@/lib/db';
import { hashPassword } from '@/lib/hash';
import { createVerificationToken, sendMail } from '@/lib/mail';

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
  const link = `${process.env.NEXTAUTH_URL ?? 'http://localhost:3000'}/verify?token=${token}`;
  await sendMail(
    normalized,
    'Verify your UBC Flow account',
    `Confirm your email by visiting:\n\n${link}\n\nThis link expires in 24 hours.`,
  );

  return { ok: true, userId: user.id };
}
