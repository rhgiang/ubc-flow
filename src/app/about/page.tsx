import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'About · UBC Flow' };

export default function AboutPage() {
  return (
    <main className="mx-auto w-full max-w-2xl px-6 py-10">
      <h1 className="sky-hero text-3xl font-semibold">About</h1>

      <div className="sky-panel mt-8 space-y-8 p-8">
        <section className="space-y-2">
          <h2 className="text-xl font-semibold text-foreground">What UBC Flow is</h2>
          <p className="text-sm leading-relaxed text-text-secondary">
            UBC Flow is a course and professor review site with a schedule planner, made for UBC
            students. You can look up a course, see what other students thought of it, check grade
            distributions, and plan a term without juggling five browser tabs.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-xl font-semibold text-foreground">Built by a student</h2>
          <p className="text-sm leading-relaxed text-text-secondary">
            This is a student project. UBC Flow is not affiliated with, endorsed by, or operated by
            the University of British Columbia. Nothing here is official — always confirm dates,
            prerequisites, and registration details with UBC directly.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-xl font-semibold text-foreground">Where the data comes from</h2>
          <p className="text-sm leading-relaxed text-text-secondary">
            Course and section information comes from UBC&apos;s public course catalogue. Grade
            distributions are UBC PAIR summaries, accessed via ubcgrades.com. Professor pages may
            link out to RateMyProfessors and Reddit for outside opinions. Reviews are written by
            students on this site.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-xl font-semibold text-foreground">Reviews are anonymous</h2>
          <p className="text-sm leading-relaxed text-text-secondary">
            Reviews you post are shown to other students without your name attached. They are tied
            to your account behind the scenes so you can edit or delete them, but nobody browsing
            the site can see who wrote what.
          </p>
        </section>
      </div>
    </main>
  );
}
