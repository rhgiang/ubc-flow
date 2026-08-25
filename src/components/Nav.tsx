import Link from 'next/link';
import { auth } from '@/lib/auth';
import NavLinks from '@/components/NavLinks';
import NavShell from '@/components/NavShell';

export default async function Nav() {
  const session = await auth();

  return (
    <NavShell>
      <nav className="nav-bar mx-auto flex max-w-6xl items-center justify-between gap-1 px-2 py-3 sm:gap-2 sm:px-6 sm:py-4">
        <Link href="/" className="nav-logo whitespace-nowrap text-base text-foreground sm:text-lg">
          UBC<span className="hidden min-[420px]:inline"> Flow</span>
        </Link>
        <NavLinks loggedIn={!!session?.user} />
      </nav>
    </NavShell>
  );
}
