import { db } from '@/lib/db';

// Kept in its own module (rather than inlined in the Google signIn callback in
// src/lib/auth.ts) so it can be imported and tested without pulling in
// next-auth, which requires a Next.js runtime context (`next/server`) that
// plain Node test environments can't resolve - same reasoning as
// authorizeCredentials.

/**
 * Finds or creates the local User row for a Google sign-in, keyed on email.
 *
 * With no Auth.js database adapter configured, Auth.js's own account-linking
 * machinery never runs - it's entirely adapter-gated. This upsert IS the
 * account linking. Keying on email alone is safe here specifically because
 * Google verifies the address before returning it: the same trust basis
 * Auth.js's own "dangerous email linking" opt-in relies on for adapter-based
 * setups. A user who first signed up with a password and later clicks
 * "Continue with Google" with the same address lands in the same account
 * rather than a duplicate.
 */
export async function linkGoogleAccount(profile: {
  email?: string | null;
  name?: string | null;
}): Promise<{ id: string } | null> {
  if (!profile.email) return null;
  const email = profile.email.trim().toLowerCase();

  return db.user.upsert({
    where: { email },
    update: {},
    create: { email, name: profile.name ?? null, emailVerified: new Date() },
    select: { id: true },
  });
}
