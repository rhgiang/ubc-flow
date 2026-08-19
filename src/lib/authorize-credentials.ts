import { db } from '@/lib/db';
import { verifyPassword } from '@/lib/hash';

// Bcrypt hash of an arbitrary unused string (cost 12) — no real password will
// ever match it. Used to pay the same bcrypt cost for nonexistent users so
// login failure latency can't be used to enumerate which emails have accounts.
const DUMMY_HASH = '$2b$12$4sX9Xy/qFm.8dakLKmXNiuL5iKJr/IdUsHrkxq3LpBezDO7dYkdVS';

// Kept in its own module (rather than inlined in the Credentials provider in
// src/lib/auth.ts) so it can be imported and tested without pulling in
// next-auth, which requires a Next.js runtime context (`next/server`) that
// plain Node test environments can't resolve.
export async function authorizeCredentials(creds: Record<string, unknown> | undefined) {
  const email = String(creds?.email ?? '').trim().toLowerCase();
  const password = String(creds?.password ?? '');
  if (!email || !password) return null;

  const user = await db.user.findUnique({ where: { email } });
  // Always run verifyPassword, even when there's no user/hash to check
  // against — never short-circuit before it, or the missing-user path
  // returns ~20x faster than the wrong-password path and becomes a
  // timing oracle for account enumeration.
  const valid = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);
  if (!user?.passwordHash || !valid) return null;

  return { id: user.id, email: user.email };
}
