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
          // With no login panel below it, the block reads as sitting too low
          // dead-centered in the viewport — nudge it up well above center.
          session?.user ? 'mb-48' : ''
        }`}
      >
        <h1 className="sky-hero text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
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
