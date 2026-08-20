import { randomBytes } from 'node:crypto';
import { db } from '@/lib/db';

const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * ponytail: console transport only. Choosing a real provider is a deployment
 * decision — swap this one function's body when there is somewhere to send to.
 */
export async function sendMail(to: string, subject: string, body: string): Promise<void> {
  console.log(`\n--- MAIL ---\nTo: ${to}\nSubject: ${subject}\n\n${body}\n------------\n`);
}

export async function createVerificationToken(userId: string): Promise<string> {
  const token = randomBytes(32).toString('hex');
  await db.verificationToken.create({
    data: { token, userId, expiresAt: new Date(Date.now() + TOKEN_TTL_MS) },
  });
  return token;
}

export async function consumeVerificationToken(
  token: string,
): Promise<{ ok: boolean; userId?: string }> {
  const row = await db.verificationToken.findUnique({ where: { token } });
  if (!row) return { ok: false };

  // Single-use: delete before acting, so a replay finds nothing.
  await db.verificationToken.delete({ where: { token } });
  if (row.expiresAt < new Date()) return { ok: false };

  await db.user.update({
    where: { id: row.userId },
    data: { emailVerified: new Date() },
  });
  return { ok: true, userId: row.userId };
}
