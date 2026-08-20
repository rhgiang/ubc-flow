import Link from 'next/link';
import { auth, signOut } from '@/lib/auth';

export default async function Nav() {
  const session = await auth();

  return (
    <header className="border-b">
      <nav className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-6 py-3">
        <Link href="/" className="text-lg font-semibold text-slate-900">
          UBC Flow
        </Link>

        <div className="flex items-center gap-6 text-sm text-slate-600">
          <Link href="/explore" className="hover:text-slate-900">
            Explore
          </Link>
          <Link href="/schedule" className="hover:text-slate-900">
            My Schedules
          </Link>
        </div>

        <div className="flex items-center gap-4 text-sm">
          {session?.user ? (
            <>
              <Link href="/onboarding" className="text-slate-600 hover:text-slate-900">
                Verify enrolment
              </Link>
              <form
                action={async () => {
                  'use server';
                  await signOut({ redirectTo: '/' });
                }}
              >
                <button type="submit" className="text-slate-600 hover:text-slate-900">
                  Sign out
                </button>
              </form>
            </>
          ) : (
            <>
              <Link href="/login" className="text-slate-600 hover:text-slate-900">
                Log in
              </Link>
              <Link href="/signup" className="text-blue-700 hover:underline">
                Sign up
              </Link>
            </>
          )}
        </div>
      </nav>
    </header>
  );
}
