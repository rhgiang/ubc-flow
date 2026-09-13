import HomeHero from '@/components/HomeHero';

// Fully static: the only visitor-specific thing here was whether the sign-in
// panel shows, and HomeHero now resolves that in the browser. The front door
// is the most-hit URL on the site; before this it server-rendered (and ran
// auth()) on every single visit.
export default function Home() {
  return (
    // A full viewport-height box, less the nav above it, so the hero centres on
    // the screen rather than in whatever is left over - and the page ends up
    // exactly the footer taller than the viewport, which is what gives the
    // footer something to be revealed by.
    <main className="flex min-h-[calc(100dvh-4.75rem)] flex-1 flex-col items-center justify-center px-6">
      <HomeHero />
    </main>
  );
}
