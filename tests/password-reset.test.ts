import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { db } from '@/lib/db';
import { createToken, consumeToken, consumeVerificationToken } from '@/lib/mail';
import { requestPasswordReset, resetPassword } from '@/app/actions/password-reset';
import { hashPassword, verifyPassword } from '@/lib/hash';

const EMAIL = 'zz-reset-test@example.com';
let userId: string;

beforeAll(async () => {
  await db.user.deleteMany({ where: { email: EMAIL } });
  const u = await db.user.create({
    data: { email: EMAIL, passwordHash: await hashPassword('original-password') },
  });
  userId = u.id;
});

beforeEach(async () => {
  await db.verificationToken.deleteMany({ where: { userId } });
});

afterAll(async () => {
  await db.verificationToken.deleteMany({ where: { userId } });
  await db.user.deleteMany({ where: { email: EMAIL } });
  await db.$disconnect();
});

describe('token purpose', () => {
  // The reason the purpose column exists. A verify link lives for 24 hours and
  // is printed to the server log by the console mail transport; if it also
  // worked as a reset link, anywhere one leaked would be account takeover.
  it('will not redeem a verify token as a reset token', async () => {
    const verify = await createToken(userId, 'verify');
    expect((await consumeToken(verify, 'reset')).ok).toBe(false);
  });

  it('will not redeem a reset token as a verify token', async () => {
    const reset = await createToken(userId, 'reset');
    expect((await consumeToken(reset, 'verify')).ok).toBe(false);
    // ...and must not have confirmed the address as a side effect.
    const u = await db.user.findUniqueOrThrow({ where: { id: userId } });
    expect(u.emailVerified).toBeNull();
  });

  it('leaves a token intact when it is rejected for the wrong purpose', async () => {
    const verify = await createToken(userId, 'verify');
    await consumeToken(verify, 'reset');
    // Still usable for what it was actually issued for.
    expect((await consumeVerificationToken(verify)).ok).toBe(true);
    await db.user.update({ where: { id: userId }, data: { emailVerified: null } });
  });
});

describe('resetPassword', () => {
  it('sets a new password and burns the token', async () => {
    const token = await createToken(userId, 'reset');
    expect(await resetPassword(token, 'a-brand-new-password')).toEqual({ ok: true });

    const u = await db.user.findUniqueOrThrow({ where: { id: userId } });
    expect(await verifyPassword('a-brand-new-password', u.passwordHash!)).toBe(true);
    expect(await verifyPassword('original-password', u.passwordHash!)).toBe(false);

    const replay = await resetPassword(token, 'yet-another-password');
    expect(replay.ok).toBe(false);
  });

  it('rejects an expired token without changing the password', async () => {
    const token = await createToken(userId, 'reset');
    await db.verificationToken.update({
      where: { token },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const before = (await db.user.findUniqueOrThrow({ where: { id: userId } })).passwordHash;
    expect((await resetPassword(token, 'expired-link-password')).ok).toBe(false);
    const after = (await db.user.findUniqueOrThrow({ where: { id: userId } })).passwordHash;
    expect(after).toBe(before);
  });

  it('rejects an unknown token', async () => {
    expect((await resetPassword('0'.repeat(64), 'some-long-password')).ok).toBe(false);
  });

  it('enforces the minimum length before touching the token', async () => {
    const token = await createToken(userId, 'reset');
    expect((await resetPassword(token, 'short')).ok).toBe(false);
    // The token survives, so a user who fat-fingers a short password can retry
    // with the same link instead of having to request another one.
    expect((await resetPassword(token, 'a-long-enough-password')).ok).toBe(true);
  });
});

describe('requestPasswordReset', () => {
  it('issues a reset token for a real account', async () => {
    await requestPasswordReset(EMAIL);
    const rows = await db.verificationToken.findMany({ where: { userId, purpose: 'reset' } });
    expect(rows).toHaveLength(1);
  });

  it('is silent and identical for an address with no account', async () => {
    const result = await requestPasswordReset('zz-nobody-here@example.com');
    // Same shape as the success path - the form must not be able to tell a
    // caller whether the address is registered.
    expect(result).toEqual({ ok: true });
  });

  it('normalises case and whitespace', async () => {
    await requestPasswordReset(`  ${EMAIL.toUpperCase()}  `);
    const rows = await db.verificationToken.findMany({ where: { userId, purpose: 'reset' } });
    expect(rows).toHaveLength(1);
  });

  it('rate limits repeats, and the older link stops working', async () => {
    await requestPasswordReset(EMAIL);
    const first = await db.verificationToken.findFirstOrThrow({ where: { userId, purpose: 'reset' } });

    // Inside the cooldown: no second link is issued, and the first still stands.
    await requestPasswordReset(EMAIL);
    const rows = await db.verificationToken.findMany({ where: { userId, purpose: 'reset' } });
    expect(rows).toHaveLength(1);
    expect(rows[0].token).toBe(first.token);

    // Past the cooldown: a new link supersedes the old one rather than joining it.
    await db.verificationToken.update({
      where: { token: first.token },
      data: { createdAt: new Date(Date.now() - 5 * 60 * 1000) },
    });
    await requestPasswordReset(EMAIL);
    const after = await db.verificationToken.findMany({ where: { userId, purpose: 'reset' } });
    expect(after).toHaveLength(1);
    expect(after[0].token).not.toBe(first.token);
    expect((await consumeToken(first.token, 'reset')).ok).toBe(false);
  });

  it('leaves any outstanding verify token alone', async () => {
    const verify = await createToken(userId, 'verify');
    await requestPasswordReset(EMAIL);
    expect(await db.verificationToken.findUnique({ where: { token: verify } })).not.toBeNull();
  });
});
