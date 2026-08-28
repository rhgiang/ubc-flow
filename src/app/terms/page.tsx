import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Terms · UBC Flow' };

export default function TermsPage() {
  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-14">
      <h1 className="sky-hero text-4xl font-semibold">Terms</h1>

      <div className="sky-panel mt-12 space-y-16 p-12 sm:p-16">
        <section className="space-y-4">
          <h2 className="text-2xl font-semibold text-foreground">Reviews</h2>
          <p className="text-base leading-relaxed text-text-secondary">
            Be honest. Write about your own experience in the course, not rumours. No harassment,
            personal attacks, or doxxing of instructors or other students. Critique the teaching,
            not the person. Reviews that break these rules can be removed, and repeat offenders can
            lose their account.
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-semibold text-foreground">Verifying your enrollment</h2>
          <p className="text-base leading-relaxed text-text-secondary">
            When you upload your Workday export to verify you&apos;re a UBC student, you&apos;re
            confirming it&apos;s genuinely yours and unaltered. Uploading someone else&apos;s
            records, or a doctored file, to get a verified badge isn&apos;t allowed and can get your
            account removed.
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-semibold text-foreground">The service</h2>
          <p className="text-base leading-relaxed text-text-secondary">
            UBC Flow is provided as-is, without warranty of any kind. It&apos;s a student project:
            data may be incomplete or out of date, and the site may go down or change. Don&apos;t
            make registration decisions on this site alone. Confirm with UBC&apos;s official
            sources.
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-semibold text-foreground">Not affiliated with UBC</h2>
          <p className="text-base leading-relaxed text-text-secondary">
            UBC Flow is not affiliated with, endorsed by, or operated by the University of British
            Columbia.
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-semibold text-foreground">Data sources</h2>
          <p className="text-base leading-relaxed text-text-secondary">
            Course information and grade data belong to their sources, UBC&apos;s public catalogue
            and UBC PAIR (via ubcgrades.com). We display them; we don&apos;t claim ownership of
            them.
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-semibold text-foreground">Changes to these terms</h2>
          <p className="text-base leading-relaxed text-text-secondary">
            These terms can change as the site changes. If they do, this page will be updated, and
            continuing to use UBC Flow after that means you&apos;re fine with the current version.
          </p>
        </section>
      </div>
    </main>
  );
}
