import { auth } from '@/lib/auth';
import AuthPanel from '@/components/AuthPanel';
import SearchBar from '@/components/SearchBar';

export default async function Home() {
  const session = await auth();

  return (
    // A full viewport-height box, less the nav above it, so the hero centres on
    // the screen rather than in whatever is left over — and the page ends up
    // exactly the footer taller than the viewport, which is what gives the
    // footer something to be revealed by.
    <main className="flex min-h-[calc(100dvh-4.75rem)] flex-1 flex-col items-center justify-center px-6">
      {/* zoom, not a pile of one-off sizes: the hero, the field and the
          explore row all come up 10% together and keep their proportions.
          Percentage widths resolve against the zoomed space, so w-full still
          fits its column on a phone. */}
      <div
        className={`mx-auto w-full max-w-2xl text-center [zoom:1.1] ${
          // Signed in, the search field IS the page, so it should sit dead
          // centre — but centring the BLOCK does not centre the field, because
          // the four-line heading above it carries the block's midpoint well
          // above the field's. Left alone the field lands at 61% down the
          // viewport; a bottom margin lifts the block until the FIELD is
          // centred, measured at 424px against a 422px midline. The previous
          // mb-48 overshot the other way, to 39%.
          //
          // Signed out, the sign-in panel hangs below and the stack is taller
          // than a phone screen, so nothing can be centred; without a nudge
          // the heading starts hard against the nav bar. Push it down instead.
          //
          // Both nudges shrink on phones (smaller lift signed in, bigger push
          // signed out): dead-centre reads as too high on a phone screen.
          session?.user ? 'mb-16 sm:mb-40' : 'mt-24 sm:mt-6'
        }`}
      >
        {/* text-2xl on phones: at 30px the headline ran four lines and owned
            most of the first screen, reading oversized next to other apps. */}
        <h1 className="sky-hero text-2xl font-semibold tracking-tight text-foreground sm:text-4xl">
          Search and explore course and professor reviews from UBC students
        </h1>

        <SearchBar defaultValue="" />

        {!session?.user && (
          <div className="mt-10 flex justify-center">
            <AuthPanel initialMode="login" />
          </div>
        )}
      </div>
    </main>
  );
}
