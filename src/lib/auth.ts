import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import Google from 'next-auth/providers/google';
import { authorizeCredentials } from '@/lib/authorize-credentials';
import { linkGoogleAccount } from '@/lib/link-google-account';

export const { handlers, auth, signIn, signOut } = NextAuth({
  // Credentials provider only supports JWT sessions in Auth.js v5 -
  // database sessions are not an option here.
  session: { strategy: 'jwt' },
  pages: { signIn: '/login' },
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      authorize: authorizeCredentials,
    }),
    Google,
  ],
  callbacks: {
    // Mutating `user.id` here propagates to the jwt callback below: with no
    // database adapter configured, Auth.js echoes this same object straight
    // through to jwt() unchanged, skipping its own (adapter-gated)
    // account-linking machinery entirely - see linkGoogleAccount for why
    // that's safe to do ourselves.
    async signIn({ user, account }) {
      if (account?.provider !== 'google') return true;
      const dbUser = await linkGoogleAccount(user);
      if (!dbUser) return false;
      user.id = dbUser.id;
      return true;
    },
    jwt({ token, user }) {
      if (user) token.uid = user.id;
      return token;
    },
    session({ session, token }) {
      if (token.uid) session.user.id = String(token.uid);
      return session;
    },
  },
});
