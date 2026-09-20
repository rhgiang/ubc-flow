// tests/canvas-mute-link.test.ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { db } from '@/lib/db';
import { createToken, peekToken } from '@/lib/mail';
import { muteReminders } from '@/app/actions/canvas';

const E = 'zz-canvas-mute@example.com';
let userId: string;

/** muteReminders finishes with redirect(), which throws a NEXT_REDIRECT by
 *  design. Asserting on the digest also proves where it sent the student. */
async function post(token: string): Promise<void> {
  const form = new FormData();
  form.set('token', token);
  await expect(muteReminders(form)).rejects.toMatchObject({
    digest: expect.stringContaining('NEXT_REDIRECT;replace;/reminders/off'),
  });
}

beforeAll(async () => {
  await db.user.deleteMany({ where: { email: E } });
  userId = (await db.user.create({ data: { email: E } })).id;
});
afterAll(async () => {
  await db.user.deleteMany({ where: { email: E } });
  await db.$disconnect();
});
beforeEach(async () => {
  await db.verificationToken.deleteMany({ where: { userId } });
  await db.reminderPreference.deleteMany({ where: { userId } });
  await db.reminderPreference.create({ data: { userId } });
});

describe('the mute link', () => {
  it('peeking leaves the token in place, so a mail scanner cannot spend it', async () => {
    const token = await createToken(userId, 'mute');
    expect(await peekToken(token, 'mute')).toEqual({ ok: true, userId });
    expect(await peekToken(token, 'mute')).toEqual({ ok: true, userId });
    expect(await db.verificationToken.count({ where: { token } })).toBe(1);
    // And nothing was muted by the look.
    expect((await db.reminderPreference.findUniqueOrThrow({ where: { userId } })).enabled).toBe(true);
  });

  it('peeking refuses a token issued for another purpose, and leaves it alone', async () => {
    const token = await createToken(userId, 'reset');
    expect(await peekToken(token, 'mute')).toEqual({ ok: false });
    expect(await db.verificationToken.count({ where: { token } })).toBe(1);
  });

  it('posting the form mutes the student and consumes the token', async () => {
    const token = await createToken(userId, 'mute');
    await post(token);
    expect((await db.reminderPreference.findUniqueOrThrow({ where: { userId } })).enabled).toBe(false);
    expect(await db.verificationToken.count({ where: { token } })).toBe(0);
  });

  it('a second post of the same token does not mute again', async () => {
    const token = await createToken(userId, 'mute');
    await post(token);
    // The student turned reminders back on from their deadlines page.
    await db.reminderPreference.update({ where: { userId }, data: { enabled: true } });
    await post(token);
    expect((await db.reminderPreference.findUniqueOrThrow({ where: { userId } })).enabled).toBe(true);
  });
});
