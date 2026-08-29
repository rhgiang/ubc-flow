'use server';

import { db } from '@/lib/db';
import { hashPassword } from '@/lib/hash';
import { createToken, consumeToken, lastTokenIssuedAt, revokeTokens, sendMail } from '@/lib/mail';

const MIN_PASSWORD = 10;

/** One request per minute per account. Enough to stop using us as a mail bomb. */
const COOLDOWN_MS = 60 * 1000;

function resetLink(token: string): string {
  const base = process.env.NEXTAUTH_URL ?? 'http://localhost:3000';
  return `${base}/reset?token=${token}`;
}

/**
 * Start a password reset.
 *
 * Returns the same value whether or not the address has an account, and never
 * says which. The login form already refuses to distinguish a bad email from a
 * bad password; a reset form that happily confirms "no account with that email"
 * would hand back the enumeration this codebase is otherwise careful to deny.
 *
 * The cooldown is silent for the same reason — a rejected repeat looks exactly
 * like an accepted one.
 */
export async function requestPasswordReset(email: string): Promise<{ ok: true }> {
  const normalized = email.trim().toLowerCase();
  const user = await db.user.findUnique({ where: { email: normalized } });

  if (user) {
    const last = await lastTokenIssuedAt(user.id, 'reset');
    if (!last || Date.now() - last.getTime() >= COOLDOWN_MS) {
      // Retire any earlier link first, so the newest email is the only one that
      // works and an older message in the inbox is inert.
      await revokeTokens(user.id, 'reset');
      const token = await createToken(user.id, 'reset');
      await sendMail(
        normalized,
        'Reset your UBC Flow password',
        `Set a new password by visiting:\n\n${resetLink(token)}\n\n` +
          `This link expires in 1 hour and can only be used once.\n\n` +
          `If you did not ask for this, you can ignore it — nothing has changed.`,
      );
    }
  }

  return { ok: true };
}

/**
 * Finish a password reset.
 *
 * Works for an account that has no password yet (one created through Google):
 * the link goes to the address on the account, so whoever holds that inbox can
 * already take it over via this flow on any site. Refusing here would add a
 * branch that behaves differently for Google accounts, which is itself a way to
 * probe how an account was created.
 *
 * ponytail: sessions are JWTs with no server-side record, so a reset cannot
 * revoke a session already issued — someone signed in stays signed in. Fixing
 * that needs a token-version column on User checked in the jwt callback, which
 * costs a database read on every request; worth it if account takeover becomes
 * a real concern rather than a theoretical one.
 */
export async function resetPassword(
  token: string,
  password: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (password.length < MIN_PASSWORD) {
    return { ok: false, error: `Password must be at least ${MIN_PASSWORD} characters.` };
  }

  const result = await consumeToken(token, 'reset');
  if (!result.ok || !result.userId) {
    return { ok: false, error: 'That reset link is invalid or has expired.' };
  }

  await db.user.update({
    where: { id: result.userId },
    data: { passwordHash: await hashPassword(password) },
  });
  return { ok: true };
}
