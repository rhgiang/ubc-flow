import Link from 'next/link';
import { effectiveRules, getProgram, selectable } from '@/guidance/registry';
import { loadCatalogue, loadOfferings, loadPrereqs, loadTerms } from '@/guidance/load';
import { obligations, walk, type Rule } from '@/guidance/rules';
import { progress, outstanding, type Completion } from '@/guidance/progress';
import { solve } from '@/guidance/solver';

export const revalidate = 300;

type SP = { program?: string; load?: string; summer?: string };

const DEFAULT_PROGRAM = 'cpsc-major-bsc-2026w';

/** Course pages are keyed the way /explore links them: "cpsc-310". */
const courseHref = (code: string) => `/course/${code.toLowerCase().replace(' ', '-')}`;

/** Subjects any rule in the program mentions — what the catalogue query needs. */
function subjectsUsed(rules: Rule[]): string[] {
  const out = new Set<string>();
  walk(rules, (r) => {
    if (r.kind === 'course') out.add(r.code.split(' ')[0]);
    if (r.kind === 'credits' && r.from.kind === 'pattern') r.from.subjects?.forEach((s) => out.add(s));
    if (r.kind === 'credits' && r.from.kind === 'codes') r.from.codes.forEach((c) => out.add(c.split(' ')[0]));
  });
  return [...out];
}

const STATE_STYLE: Record<string, string> = {
  satisfied: 'border-brand bg-brand text-brand-foreground',
  partial: 'border-border bg-surface-muted text-foreground',
  outstanding: 'border-border text-text-secondary',
  unevaluated: 'border-danger-border bg-danger-surface text-danger',
};

export default async function GuidancePage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const program = getProgram(sp.program ?? DEFAULT_PROGRAM) ?? getProgram(DEFAULT_PROGRAM)!;
  const load = Math.min(6, Math.max(1, Number(sp.load) || 4));
  const useSummer = sp.summer === '1';

  const rules = effectiveRules(program);
  const subjects = subjectsUsed(rules);

  const [catalogue, terms] = await Promise.all([loadCatalogue(subjects), loadTerms()]);
  const ids = catalogue.map((c) => c.id);
  const [prereqs, offerings] = await Promise.all([loadPrereqs(catalogue), loadOfferings(ids)]);

  // No completion data yet — Enrollment records registration, not whether a
  // course was passed, so treating it as completed would be wrong in the
  // dangerous direction. Until grades are captured this plans a fresh start,
  // which is exactly the public roadmap a signed-out visitor should see.
  const completions: Completion[] = [];
  const checklist = progress(completions, rules);
  const plan = solve({
    outstanding: outstanding(completions, rules),
    completed: [],
    catalogue,
    prereqs,
    offerings,
    terms,
    prefs: { load, useSummer, targetTermId: null },
  });

  const totalRules = obligations(rules).filter((r) => r.kind !== 'note').length;
  const href = (over: Record<string, string | number>) => {
    const p = new URLSearchParams({
      program: program.code,
      load: String(load),
      ...(useSummer ? { summer: '1' } : {}),
      ...Object.fromEntries(Object.entries(over).map(([k, v]) => [k, String(v)])),
    });
    return `/guidance?${p}`;
  };

  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-10">
      <h1 className="sky-hero text-3xl font-semibold">Guidance</h1>
      <p className="sky-hero mt-2 max-w-2xl text-sm">
        A term-by-term route through your degree, ordered so prerequisites come first and every
        course is one UBC actually offers.
      </p>

      <div className="mt-6 flex flex-wrap items-center gap-2">
        {selectable.map((p) => (
          <Link
            key={p.code}
            href={href({ program: p.code })}
            className={`rounded-pill border px-4 py-2 text-sm font-medium ${
              p.code === program.code
                ? 'border-brand bg-brand text-brand-foreground'
                : 'border-border text-foreground hover:bg-surface-muted'
            }`}
          >
            {p.name}
          </Link>
        ))}
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="min-w-0">
          <div className="sky-panel p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-foreground">Suggested route</h2>
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-text-secondary">Courses per term</span>
                {[3, 4, 5].map((n) => (
                  <Link
                    key={n}
                    href={href({ load: n })}
                    className={`rounded-pill border px-3 py-1 text-xs font-medium ${
                      n === load
                        ? 'border-brand bg-brand text-brand-foreground'
                        : 'border-border text-foreground hover:bg-surface-muted'
                    }`}
                  >
                    {n}
                  </Link>
                ))}
                <Link
                  href={href({ summer: useSummer ? '' : '1' })}
                  className={`ml-1 rounded-pill border px-3 py-1 text-xs font-medium ${
                    useSummer
                      ? 'border-brand bg-brand text-brand-foreground'
                      : 'border-border text-foreground hover:bg-surface-muted'
                  }`}
                >
                  Use summer
                </Link>
              </div>
            </div>

            {plan.terms.length === 0 ? (
              <p className="mt-4 text-sm text-text-secondary">
                No terms could be planned — the catalogue has no upcoming sections to place
                against.
              </p>
            ) : (
              <ol className="mt-4 space-y-3">
                {plan.terms.map((t) => (
                  <li key={t.term.id} className="rounded-card border border-border p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-text-secondary">
                      {t.term.name}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {t.placements.map((pl, i) =>
                        pl.kind === 'course' ? (
                          <Link
                            key={pl.course.id}
                            href={courseHref(pl.course.code)}
                            className="rounded-pill border border-border bg-surface-muted px-3 py-1 text-sm font-medium text-foreground hover:border-brand hover:bg-brand hover:text-brand-foreground"
                          >
                            {pl.course.code}
                            <span className="ml-1.5 text-xs opacity-70">{pl.course.credits}cr</span>
                          </Link>
                        ) : (
                          // Dashed: a slot is a decision the student still has
                          // to make, not a course we are telling them to take.
                          <span
                            key={`${pl.label}-${i}`}
                            className="rounded-pill border border-dashed border-border px-3 py-1 text-sm font-medium text-text-secondary"
                            title={
                              pl.examples.length > 0
                                ? `e.g. ${pl.examples.map((e) => e.code).join(', ')}`
                                : undefined
                            }
                          >
                            {pl.credits}cr · {pl.label}
                            {pl.examples.length > 0 && (
                              <span className="ml-1.5 text-xs opacity-70">
                                e.g. {pl.examples[0].code}
                              </span>
                            )}
                          </span>
                        ),
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            )}

            {plan.unplaced.length > 0 && (
              <div className="mt-4 rounded-card border border-border p-3">
                <p className="text-xs font-semibold text-text-secondary">Could not be placed</p>
                <ul className="mt-1.5 space-y-1 text-xs text-text-secondary">
                  {plan.unplaced.map((u) => (
                    <li key={u.rule.id}>
                      <span className="font-medium text-foreground">{u.rule.label}</span> — {u.reason}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>

        <aside className="sky-panel h-fit p-5">
          <p className="text-sm font-semibold text-foreground">Requirements</p>
          <p className="mt-1 text-xs text-text-secondary">
            {totalRules} checkable · {program.totalCredits} credits total
          </p>

          <ul className="mt-3 space-y-1.5">
            {checklist.map((p) => (
              <li
                key={p.rule.id}
                className={`rounded-card border px-3 py-2 text-xs ${STATE_STYLE[p.state]}`}
              >
                <span className="font-medium">{p.rule.label}</span>
                <span className="ml-1.5 opacity-80">{p.detail}</span>
              </li>
            ))}
          </ul>
        </aside>
      </div>

      {plan.warnings.length > 0 && (
        <div className="sky-panel mt-6 border border-danger-border bg-danger-surface p-4 text-sm text-danger">
          {plan.warnings.map((w) => (
            <p key={w}>{w}</p>
          ))}
          <p className="mt-1.5 text-xs opacity-80">
            This route is a planning aid, not an official degree audit. Confirm with a Science
            advisor before relying on it.
          </p>
        </div>
      )}
    </main>
  );
}
