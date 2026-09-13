import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'About' };

export default function AboutPage() {
  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-14">
      <h1 className="sky-hero text-2xl font-semibold sm:text-4xl">About</h1>

      <div className="sky-panel mt-12 space-y-16 p-6 sm:p-12 lg:p-16">
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
            description. Every review you leave makes course selection easier for the 60,000 other
            UBC students.
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

        <section className="space-y-6">
          <h2 className="text-2xl font-semibold text-foreground">Founder</h2>
          {/*
            Framed to match his GitHub avatar, which is this same photo: the
            whole seated figure rather than a face crop. Cut from the original
            at full width, so it carries 540px where the avatar endpoint serves
            460. The round shape is CSS, so the file stays reusable if it ever
            changes.

            Much larger than the 64px placeholder it replaces - the section is
            about a person, and at avatar size it read as a bullet point.
          */}
          <div className="flex flex-col items-start gap-6 sm:flex-row sm:items-start sm:gap-8">
            <img
              src="/founder.webp"
              alt="Ryan Giang"
              width={540}
              height={540}
              loading="lazy"
              decoding="async"
              className="h-36 w-36 shrink-0 rounded-full object-cover sm:h-44 sm:w-44"
            />
            <div className="min-w-0">
              <p className="text-2xl font-semibold text-foreground">Ryan Giang</p>
              <p className="mt-1 text-base text-text-secondary">UBC Computer Science Student</p>
              <p className="mt-4 text-base leading-relaxed text-text-secondary">
                Ryan is the developer behind UBC Flow. He enjoys building products that make
                tasks easier, and values UX design.
              </p>
              <p className="mt-3 text-base leading-relaxed text-text-secondary">
                He&apos;s especially interested in computer vision and robotics. Outside of
                programming, you&apos;ll find him deep in sports, fitness, and photography.
              </p>
              <p className="mt-4 flex flex-wrap gap-4 text-base">
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
