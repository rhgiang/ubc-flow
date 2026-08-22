import Link from 'next/link';
import { auth } from '@/lib/auth';
import NavLinks from '@/components/NavLinks';

export default async function Nav() {
  const session = await auth();

  return (
    <header className="border-b border-border-hairline bg-background">
      <nav className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <Link href="/" className="text-lg font-semibold tracking-tight text-foreground">
          UBC Flow
        </Link>
        <NavLinks loggedIn={!!session?.user} />
      </nav>
    </header>
  );
}
