import Link from 'next/link';
import { auth } from '@/lib/auth';
import NavLinks from '@/components/NavLinks';
import NavShell from '@/components/NavShell';

export default async function Nav() {
  const session = await auth();

  return (
    <NavShell>
      <nav className="nav-bar mx-auto flex max-w-7xl items-center justify-between px-5 py-2.5 sm:px-7 sm:py-3">
        <Link href="/" className="nav-logo text-lg text-foreground">
          UBC Flow
        </Link>
        <NavLinks loggedIn={!!session?.user} />
      </nav>
    </NavShell>
  );
}
