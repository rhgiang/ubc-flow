import { createHmac } from 'node:crypto';
import bcrypt from 'bcryptjs';

const BCRYPT_ROUNDS = 12;

/**
 * HMAC, not a bare hash: UBC student numbers occupy a ~8-digit space, so a
 * plain SHA-256 column could be brute-forced back to every student number in
 * seconds. Keying with a server-side secret makes the digests useless alone.
 */
export function hashStudentNumber(raw: string): string {
  const secret = process.env.SERVER_SECRET;
  if (!secret) {
    throw new Error('SERVER_SECRET is not set. Refusing to hash unkeyed.');
  }
  return createHmac('sha256', secret).update(raw.trim()).digest('hex');
}

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}
