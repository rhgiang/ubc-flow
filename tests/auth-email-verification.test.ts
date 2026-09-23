import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { db } from '@/lib/db';

const sent: { to: string; subject: string }[] = [];
vi.mock('@/lib/mail', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/mail')>();
  return {
    ...real,
    sendMail: vi.fn(async (to: string, subject: string) => { sent.push({ to, subject }); return true; }),
  };
});

import { authorizeCredentials } from '@/lib/authorize-credentials';
import { resendVerification } from '@/app/actions/auth';
import { hashPassword } from '@/lib/hash';

const E = 'zz-verify-gate@example.com';
const PW = 'correct-horse-battery';
let userId: string;

beforeAll(async () => {
  await db.user.deleteMany({ where: { email: E } });
  userId = (await db.user.create({
    data: { email: E, passwordHash: await hashPassword(PW) },
  })).id;
});
afterAll(async () => {
  await db.user.deleteMany({ where: { email: E } });
  await db.$disconnect();
});
beforeEach(async () => {
  sent.length = 0;
  await db.verificationToken.deleteMany({ where: { userId } });
  await db.user.update({
    where: { id: userId },
    data: { emailVerified: null, failedLogins: 0, lockedUntil: null },
  });
});

describe('sign-in requires a verified address', () => {
  it('refuses an unverified account even with the right password', async () => {
    expect(await authorizeCredentials({ email: E, password: PW })).toBeNull();
  });

  it('allows it once verified', async () => {
    await db.user.update({ where: { id: userId }, data: { emailVerified: new Date() } });
    const r = await authorizeCredentials({ email: E, password: PW });
    expect(r).toEqual({ id: userId, email: E });
  });

  it('says nothing different from a wrong password, so it leaks no account', async () => {
    // Both null. If the unverified branch returned anything distinguishable,
    // it would confirm the address has an account.
    const unverified = await authorizeCredentials({ email: E, password: PW });
    const wrongPassword = await authorizeCredentials({ email: E, password: 'not-the-password' });
    const noSuchUser = await authorizeCredentials({ email: 'zz-nobody@example.com', password: PW });
    expect(unverified).toBeNull();
    expect(wrongPassword).toBeNull();
    expect(noSuchUser).toBeNull();
  });

  it('does not count a verification refusal as a failed login attempt', async () => {
    // Otherwise someone who signed up and forgot to confirm would lock
    // themselves out by retrying, on top of not being told why.
    await authorizeCredentials({ email: E, password: PW });
    await authorizeCredentials({ email: E, password: PW });
    const u = await db.user.findUniqueOrThrow({ where: { id: userId } });
    expect(u.failedLogins).toBe(0);
    expect(u.lockedUntil).toBeNull();
  });
});

describe('resendVerification', () => {
  it('sends a fresh link to an unverified account', async () => {
    expect(await resendVerification(E)).toEqual({ ok: true });
    expect(sent.map((m) => m.subject)).toEqual(['Verify your UBC Flow account']);
    expect(await db.verificationToken.count({ where: { userId, purpose: 'verify' } })).toBe(1);
  });

  it('retires the previous link, so only the newest works', async () => {
    await resendVerification(E);
    const first = await db.verificationToken.findFirstOrThrow({ where: { userId } });
    await db.verificationToken.update({
      where: { token: first.token },
      data: { createdAt: new Date(Date.now() - 5 * 60_000) },
    });
    await resendVerification(E);
    const tokens = await db.verificationToken.findMany({ where: { userId, purpose: 'verify' } });
    expect(tokens).toHaveLength(1);
    expect(tokens[0].token).not.toBe(first.token);
  });

  it('holds to one a minute', async () => {
    await resendVerification(E);
    await resendVerification(E);
    expect(sent).toHaveLength(1);
  });

  it('sends nothing for an address that is already verified', async () => {
    await db.user.update({ where: { id: userId }, data: { emailVerified: new Date() } });
    expect(await resendVerification(E)).toEqual({ ok: true });
    expect(sent).toHaveLength(0);
  });

  it('answers the same for an address with no account, and sends nothing', async () => {
    expect(await resendVerification('zz-nobody-at-all@example.com')).toEqual({ ok: true });
    expect(sent).toHaveLength(0);
  });
});
