import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { db } from '@/lib/db';

// Spy on verifyPassword while keeping the real bcrypt implementation - the
// point is to prove it's actually invoked on the nonexistent-user path, not
// to fake its result.
vi.mock('@/lib/hash', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/hash')>();
  return { ...actual, verifyPassword: vi.fn(actual.verifyPassword) };
});

const { verifyPassword } = await import('@/lib/hash');
const { authorizeCredentials } = await import('@/lib/authorize-credentials');

const NONEXISTENT_EMAIL = 'zz-does-not-exist@example.com';

beforeAll(async () => {
  process.env.SERVER_SECRET ??= 'test-secret';
  await db.user.deleteMany({ where: { email: NONEXISTENT_EMAIL } });
});

afterAll(async () => {
  await db.$disconnect();
});

describe('authorizeCredentials timing-oracle fix', () => {
  it('calls verifyPassword even when no user exists (no early-return shortcut)', async () => {
    vi.mocked(verifyPassword).mockClear();

    const result = await authorizeCredentials({
      email: NONEXISTENT_EMAIL,
      password: 'whatever-password-123',
    });

    expect(result).toBeNull();
    // The whole fix hinges on this: bcrypt cost must be paid regardless of
    // whether a user row was found, or the missing-user path stays ~20x
    // faster and remains a login-timing account-enumeration oracle.
    expect(verifyPassword).toHaveBeenCalledTimes(1);
    expect(verifyPassword).toHaveBeenCalledWith('whatever-password-123', expect.any(String));
  });
});
