import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Terms · UBC Flow' };

export default function TermsPage() {
  return (
    <main className="mx-auto w-full max-w-2xl px-6 py-10">
      <h1 className="sky-hero text-3xl font-semibold">Terms</h1>

      <div className="sky-panel mt-8 space-y-8 p-8">
        <section className="space-y-2">
          <h2 className="text-xl font-semibold text-foreground">Reviews</h2>
          <p className="text-sm leading-relaxed text-text-secondary">
            Be honest. Write about your own experience in the course, not rumours. No harassment,
            personal attacks, or doxxing of instructors or other students — critique the teaching,
            not the person. Reviews that break these rules can be removed, and repeat offenders can
            lose their account.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-xl font-semibold text-foreground">The service</h2>
          <p className="text-sm leading-relaxed text-text-secondary">
            UBC Flow is provided as-is, without warranty of any kind. It&apos;s a student project:
            data may be incomplete or out of date, and the site may go down or change. Don&apos;t
            make registration decisions on this site alone — confirm with UBC&apos;s official
            sources.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-xl font-semibold text-foreground">Not affiliated with UBC</h2>
          <p className="text-sm leading-relaxed text-text-secondary">
            UBC Flow is not affiliated with, endorsed by, or operated by the University of British
            Columbia.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-xl font-semibold text-foreground">Data sources</h2>
          <p className="text-sm leading-relaxed text-text-secondary">
            Course information and grade data belong to their sources — UBC&apos;s public catalogue
            and UBC PAIR (via ubcgrades.com). We display them; we don&apos;t claim ownership of
            them.
          </p>
        </section>
      </div>
    </main>
  );
}
