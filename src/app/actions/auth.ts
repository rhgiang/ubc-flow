'use server';

import { db } from '@/lib/db';
import { hashPassword } from '@/lib/hash';

const MIN_PASSWORD = 10;
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

  const user = await db.user.create({
    data: { email: normalized, passwordHash: await hashPassword(password) },
  });

  return { ok: true, userId: user.id };
}
