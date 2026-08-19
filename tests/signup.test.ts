import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '@/lib/db';
import { registerUser } from '@/app/actions/auth';
import { verifyPassword } from '@/lib/hash';

const EMAIL = 'zz-signup-test@example.com';

beforeAll(async () => {
  process.env.SERVER_SECRET ??= 'test-secret';
  await db.user.deleteMany({ where: { email: EMAIL } });
});

afterAll(async () => {
  await db.user.deleteMany({ where: { email: EMAIL } });
  await db.$disconnect();
});

describe('registerUser', () => {
  it('creates a user with a hashed password', async () => {
    const r = await registerUser(EMAIL, 'a-good-password-123');
    expect(r.ok).toBe(true);

    const user = await db.user.findUniqueOrThrow({ where: { email: EMAIL } });
    expect(user.passwordHash).toBeTruthy();
    expect(user.passwordHash).not.toBe('a-good-password-123');
    expect(await verifyPassword('a-good-password-123', user.passwordHash!)).toBe(true);
  });

  it('refuses a duplicate email', async () => {
    const r = await registerUser(EMAIL, 'another-password-456');
    expect(r.ok).toBe(false);
  });

  it('rejects a too-short password', async () => {
    const r = await registerUser('zz-short@example.com', 'abc');
    expect(r.ok).toBe(false);
  });

  it('rejects a malformed email', async () => {
    const r = await registerUser('not-an-email', 'a-good-password-123');
    expect(r.ok).toBe(false);
  });

  it('does not domain-restrict the email', async () => {
    const r = await registerUser('zz-gmail-test@gmail.com', 'a-good-password-123');
    expect(r.ok).toBe(true);
    await db.user.deleteMany({ where: { email: 'zz-gmail-test@gmail.com' } });
  });
});
