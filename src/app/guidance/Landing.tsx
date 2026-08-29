import Link from 'next/link';
import { byDegree, fullLoadFor } from '@/guidance/registry';

/**
 * The subject badge on a card — the first segment of the program code, which
 * is the subject a student already thinks of the program by. "CPSC", not
 * "Computer Science Major".
 */
const badge = (code: string) => code.split('-')[0].toUpperCase();

/**
 * What each credential is, in one line. The names are opaque to anyone who has
 * not already chosen one, and the whole point of this page is to be read by
 * someone who has not.
 */
const BLURB: Record<string, string> = {
  BASc: 'Engineering. Co-op sequences available.',
  BSc: 'Science majors. 120 credits, built on the Faculty of Science core.',
  BCom: 'Sauder. One core, four specialisations to choose between.',
  BA: 'Arts majors. 120 credits, built on the Faculty of Arts core.',
};

/**
 * The program picker, shown when no program is chosen.
 *
 * This used to be twenty-six pills in a single wrapped row above the roadmap,
 * which is a list you scan rather than a choice you make: nothing said which
 * degree a name belonged to, and the row alone ran four lines deep before the
 * page's actual content began. Splitting the choice onto its own route also
 * means an unchosen visitor never pays for the catalogue, prereq and offerings
 * queries the roadmap needs.
 */
export default function Landing() {
  const groups = byDegree();

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-14">
      <header className="max-w-2xl">
        <h1 className="sky-hero text-4xl font-semibold tracking-tight">Guidance</h1>
        <p className="sky-hero mt-3 text-base">
          A term-by-term route through your degree, ordered so prerequisites come first and every
          course is one UBC actually offers.
        </p>
        <p className="sky-hero mt-2 text-sm opacity-75">
          Pick a program to see its roadmap, built from 2026W requirements.
        </p>
      </header>

      <div className="mt-10 space-y-6">
        {groups.map((group) => (
          <section key={group.degree} className="sky-panel p-6">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h2 className="text-lg font-semibold text-foreground">{group.degree}</h2>
              <span className="text-sm text-text-secondary">Faculty of {group.faculty}</span>
              <span className="ml-auto text-xs text-text-secondary">
                {group.programs.length} program{group.programs.length === 1 ? '' : 's'}
              </span>
            </div>
            {BLURB[group.degree] && (
              <p className="mt-1 text-sm text-text-secondary">{BLURB[group.degree]}</p>
            )}

            <ul className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {group.programs.map((p) => (
                <li key={p.code}>
                  {/* The whole card is the link — a name plus two facts is not
                      enough content to justify a separate call to action. */}
                  <Link
                    href={`/guidance?program=${p.code}`}
                    className="group flex h-full flex-col rounded-card border border-border p-4 transition-colors hover:border-brand hover:bg-surface-muted"
                  >
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-brand-accent">
                      {badge(p.code)}
                    </span>
                    <span className="mt-1 text-sm font-medium leading-snug text-foreground">
                      {p.name}
                    </span>
                    <span className="mt-auto pt-3 text-xs text-text-secondary">
                      {p.totalCredits} credits · {fullLoadFor(p)} a term
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      <p className="sky-hero mt-8 text-center text-xs opacity-70">
        Requirements are transcribed from the UBC Academic Calendar. A roadmap here is a planning
        aid, not an official degree audit.
      </p>
    </main>
  );
}
