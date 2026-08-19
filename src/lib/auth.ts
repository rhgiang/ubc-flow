import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { authorizeCredentials } from '@/lib/authorize-credentials';

export const { handlers, auth, signIn, signOut } = NextAuth({
  // Credentials provider only supports JWT sessions in Auth.js v5 —
  // database sessions are not an option here.
  session: { strategy: 'jwt' },
  pages: { signIn: '/login' },
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      authorize: authorizeCredentials,
    }),
  ],
  callbacks: {
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
