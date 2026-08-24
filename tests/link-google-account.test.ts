import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '@/lib/db';
import { linkGoogleAccount } from '@/lib/link-google-account';

const NEW_EMAIL = 'zz-google-new@example.com';
const EXISTING_EMAIL = 'zz-google-existing@example.com';

let existingUserId: string;

beforeAll(async () => {
  await db.user.deleteMany({ where: { email: { in: [NEW_EMAIL, EXISTING_EMAIL] } } });
  // Simulates a user who signed up with a password before ever using Google.
  existingUserId = (
    await db.user.create({ data: { email: EXISTING_EMAIL, passwordHash: 'not-a-real-hash' } })
  ).id;
});

afterAll(async () => {
  await db.user.deleteMany({ where: { email: { in: [NEW_EMAIL, EXISTING_EMAIL] } } });
  await db.$disconnect();
});

describe('linkGoogleAccount', () => {
  it('creates a new verified user for an email that has never signed up', async () => {
    const result = await linkGoogleAccount({ email: NEW_EMAIL, name: 'New Student' });
    expect(result).not.toBeNull();

    const row = await db.user.findUnique({ where: { email: NEW_EMAIL } });
    expect(row?.id).toBe(result!.id);
    expect(row?.name).toBe('New Student');
    expect(row?.emailVerified).not.toBeNull();
    // Never fabricates a password for an OAuth-only account.
    expect(row?.passwordHash).toBeNull();
  });

  it('signs into the existing account rather than creating a duplicate', async () => {
    const result = await linkGoogleAccount({ email: EXISTING_EMAIL });
    expect(result?.id).toBe(existingUserId);

    const count = await db.user.count({ where: { email: EXISTING_EMAIL } });
    expect(count).toBe(1);
  });

  it("does not overwrite the existing account's password on linking", async () => {
    await linkGoogleAccount({ email: EXISTING_EMAIL });
    const row = await db.user.findUnique({ where: { email: EXISTING_EMAIL } });
    // Linking must not silently strip the password-login path.
    expect(row?.passwordHash).toBe('not-a-real-hash');
  });

  it('normalizes email case, so Google and password login resolve to one account', async () => {
    const result = await linkGoogleAccount({ email: EXISTING_EMAIL.toUpperCase() });
    expect(result?.id).toBe(existingUserId);
  });

  it('refuses to link when Google reports no email', async () => {
    expect(await linkGoogleAccount({ email: null })).toBeNull();
    expect(await linkGoogleAccount({ email: undefined })).toBeNull();
  });
});
