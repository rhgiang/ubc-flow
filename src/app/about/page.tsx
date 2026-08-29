import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'About' };

export default function AboutPage() {
  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-14">
      <h1 className="sky-hero text-4xl font-semibold">About</h1>

      <div className="sky-panel mt-12 space-y-16 p-12 sm:p-16">
        <section className="space-y-4">
          <h2 className="text-2xl font-semibold text-foreground">What UBC Flow is</h2>
          <p className="text-base leading-relaxed text-text-secondary">
            UBC Flow is a course planning site with a built-in schedule planner, made by UBC
            students, for UBC students. Inspired by the University of Waterloo&apos;s UW Flow, it
            set out to be the only tool you need before Workday registration day.
          </p>
          <p className="text-base leading-relaxed text-text-secondary">
            UBC Flow has an assortment of tools for looking up a course, reading student reviews,
            checking real grade distributions, comparing a professor against the course average,
            and building your term schedule, all without ten tabs open at once. Once you&apos;ve
            built a schedule, it syncs straight to your phone&apos;s calendar, so it&apos;s already
            there when you need it. Grade data, quick links out to RateMyProfessors and Reddit, a
            direct Workday import, and term-by-term degree guidance all live here too.
          </p>
          <p className="text-base leading-relaxed text-text-secondary">
            We want to know everything about your student experience, how brutal the course
            material actually is, whether a professor&apos;s lectures match the textbook, or that
            one professor you absolutely adored. All of the feedback you don&apos;t get in a course
            description. Every review you leave makes course selection easier for the nearly 75,000
            other UBC students.
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-semibold text-foreground">History</h2>
          <p className="text-base leading-relaxed text-text-secondary">
            UBC Flow started as a first-year side project. Its founder, Ryan Giang, transferred
            universities and programs from Engineering into Computer Science and immediately ran
            into the same wall every UBC student hits when it&apos;s time to register courses: not
            enough information on courses, and a Workday system with no real infrastructure for the
            simple things like viewing your schedule, finding a section, and seeing degree
            requirements. All of it became a hassle.
          </p>
          <p className="text-base leading-relaxed text-text-secondary">
            Planning which courses to take should be more convenient and accessible, so he built
            the tool he wished existed.
          </p>
          <p className="text-base leading-relaxed text-text-secondary">
            UBC Flow is still an independent, unofficial project, not affiliated with, endorsed by,
            or run by UBC. Always double-check dates, prerequisites, and registration details
            directly with the university.
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-semibold text-foreground">Founder</h2>
          <div className="flex items-center gap-4">
            {/* Placeholder until a real photo is uploaded. */}
            <div
              aria-hidden
              className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-surface-muted text-text-tertiary"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-8 w-8">
                <circle cx="12" cy="8" r="3.5" />
                <path d="M4.5 20c1.5-4 5-6 7.5-6s6 2 7.5 6" strokeLinecap="round" />
              </svg>
            </div>
            <div>
              <p className="text-base font-medium text-foreground">Ryan Giang</p>
              <p className="text-base text-text-secondary">UBC Computer Science Student</p>
              <p className="mt-1.5 flex gap-3 text-sm">
                <a
                  href="https://www.linkedin.com/in/ryanhgiang"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-brand-accent hover:underline"
                >
                  LinkedIn ↗
                </a>
                <a
                  href="https://github.com/rhgiang"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-brand-accent hover:underline"
                >
                  GitHub ↗
                </a>
              </p>
            </div>
          </div>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-semibold text-foreground">Where the data comes from</h2>
          <p className="text-base leading-relaxed text-text-secondary">
            Course and section information comes from UBC&apos;s public course catalogue. Grade
            distributions are UBC PAIR summaries, accessed via ubcgrades.com. Professor pages may
            link out to RateMyProfessors and Reddit for outside opinions. Reviews are written by
            students on this site.
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-semibold text-foreground">Reviews are anonymous</h2>
          <p className="text-base leading-relaxed text-text-secondary">
            Reviews you post are shown to other students without your name attached. They are tied
            to your account behind the scenes so you can edit or delete them, but nobody browsing
            the site can see who wrote what.
          </p>
        </section>
      </div>
    </main>
  );
}
