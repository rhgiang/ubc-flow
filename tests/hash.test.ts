import { describe, it, expect, beforeAll } from 'vitest';
import { hashStudentNumber, hashPassword, verifyPassword } from '@/lib/hash';

beforeAll(() => {
  process.env.SERVER_SECRET ??= 'test-secret-do-not-use-in-production';
});

describe('hashStudentNumber', () => {
  it('is deterministic for the same input', () => {
    expect(hashStudentNumber('12345678')).toBe(hashStudentNumber('12345678'));
  });

  it('differs for different students', () => {
    expect(hashStudentNumber('12345678')).not.toBe(hashStudentNumber('87654321'));
  });

  it('never returns the raw number', () => {
    expect(hashStudentNumber('12345678')).not.toContain('12345678');
  });

  it('produces a 64-char hex digest', () => {
    expect(hashStudentNumber('12345678')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is keyed — a different secret yields a different digest', () => {
    const a = hashStudentNumber('12345678');
    const prev = process.env.SERVER_SECRET;
    process.env.SERVER_SECRET = 'a-different-secret';
    const b = hashStudentNumber('12345678');
    process.env.SERVER_SECRET = prev;
    expect(a).not.toBe(b);
  });

  it('throws when SERVER_SECRET is absent rather than hashing unkeyed', () => {
    const prev = process.env.SERVER_SECRET;
    delete process.env.SERVER_SECRET;
    expect(() => hashStudentNumber('12345678')).toThrow(/SERVER_SECRET/);
    process.env.SERVER_SECRET = prev;
  });
});

describe('passwords', () => {
  it('verifies a correct password', async () => {
    const h = await hashPassword('correct horse battery staple');
    expect(await verifyPassword('correct horse battery staple', h)).toBe(true);
  });

  it('rejects an incorrect password', async () => {
    const h = await hashPassword('correct horse battery staple');
    expect(await verifyPassword('wrong password', h)).toBe(false);
  });

  it('never stores the plaintext in the hash', async () => {
    const h = await hashPassword('hunter2');
    expect(h).not.toContain('hunter2');
  });
});
