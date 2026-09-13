import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '@/lib/db';
import { createVerificationToken, consumeVerificationToken } from '@/lib/mail';

let userId: string;
const EMAIL = 'zz-verify-test@example.com';

beforeAll(async () => {
  await db.user.deleteMany({ where: { email: EMAIL } });
  const u = await db.user.create({ data: { email: EMAIL } });
  userId = u.id;
});

afterAll(async () => {
  await db.verificationToken.deleteMany({ where: { userId } });
  await db.user.deleteMany({ where: { email: EMAIL } });
  await db.$disconnect();
});

describe('verification tokens', () => {
  it('issues a high-entropy token', async () => {
    const t = await createVerificationToken(userId);
    expect(t).toMatch(/^[0-9a-f]{64}$/);
  });

  it('consumes a valid token exactly once', async () => {
    const t = await createVerificationToken(userId);
    expect((await consumeVerificationToken(t)).ok).toBe(true);
    // Replay must fail - a verification link is single-use.
    expect((await consumeVerificationToken(t)).ok).toBe(false);
  });

  it('rejects an unknown token', async () => {
    expect((await consumeVerificationToken('0'.repeat(64))).ok).toBe(false);
  });

  it('rejects an expired token', async () => {
    const t = await createVerificationToken(userId);
    await db.verificationToken.update({
      where: { token: t },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect((await consumeVerificationToken(t)).ok).toBe(false);
  });

  it('sets emailVerified on the user when consumed', async () => {
    const t = await createVerificationToken(userId);
    await consumeVerificationToken(t);
    const u = await db.user.findUniqueOrThrow({ where: { id: userId } });
    expect(u.emailVerified).toBeTruthy();
  });
});
