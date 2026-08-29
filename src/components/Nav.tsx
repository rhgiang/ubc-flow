import Link from "next/link";
import { auth } from "@/lib/auth";
import NavLinks from "@/components/NavLinks";
import NavShell from "@/components/NavShell";
import { CLOUD, WAVE_UPPER, WAVE_LOWER, MARK_VIEWBOX } from "@/lib/mark";

export default async function Nav() {
  const session = await auth();

  return (
    <NavShell>
      {/* The bar spans the viewport; only its contents are held to the
          content width, so the strip reads as part of the page frame rather
          than a card floating on top of it. */}
      <nav className="nav-bar">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-2.5 sm:px-7 sm:py-3">
          <Link
            href="/"
            className="nav-logo flex items-center gap-2 text-lg text-foreground"
          >
            {/* currentColor, not the favicon's navy tile: the wordmark turns
              white on the sky and back to foreground in the schedule builder,
              and the mark has to follow it. */}
            <svg
              viewBox={MARK_VIEWBOX}
              fill="currentColor"
              aria-hidden
              className="h-[1.5em] w-[1.5em] shrink-0"
            >
              <path d={CLOUD} />
              <path d={WAVE_UPPER} />
              <path d={WAVE_LOWER} />
            </svg>
            UBC Flow
          </Link>
          <NavLinks loggedIn={!!session?.user} />
        </div>
      </nav>
    </NavShell>
  );
}
