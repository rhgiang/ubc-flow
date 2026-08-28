import Link from 'next/link';
import { effectiveRules, getProgram, selectable } from '@/guidance/registry';
import { loadCatalogue, loadOfferings, loadPrereqs, loadTerms } from '@/guidance/load';
import { obligations, walk, type CourseSet, type Rule } from '@/guidance/rules';
import { progress, outstanding, type Completion } from '@/guidance/progress';
import { solve } from '@/guidance/solver';

export const revalidate = 300;

// `credits`, not `load`. The control used to mean courses per term and the
// parameter was called load; changing its meaning to credits while keeping the
// name left every existing link and bookmark reading "4" as four CREDITS —
// one course a term, a twelve-term plan. A new name lets stale links fall
// through to the default instead of silently meaning something else.
type SP = { program?: string; credits?: string; summer?: string };

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


/** A course set in words, so a student can see what a rule actually accepts. */
function describeSet(set: CourseSet): string {
  if (set.kind === 'codes') {
    return set.codes.length > 0 ? set.codes.join(', ') : 'an approved list (not yet transcribed)';
  }
  const bits: string[] = [];
  if (set.subjects?.length) bits.push(set.subjects.join(' or '));
  if (set.faculty) bits.push(`any ${set.faculty} subject`);
  if (set.levelMin && set.levelMax) bits.push(`${set.levelMin}–${set.levelMax}`);
  else if (set.levelMin) bits.push(`${set.levelMin} or higher`);
  else if (set.levelMax) bits.push(`up to ${set.levelMax}`);
  if (set.exclude?.length) bits.push(`excluding ${set.exclude.join(', ')}`);
  return bits.join(', ') || 'any course';
}

/**
 * The sub-requirements behind a rule, for the expandable detail. Breadth is
 * the case that needs it — "any 6 of 7 categories" means nothing without the
 * list of categories and what counts in each.
 */
function breakdown(rule: Rule): { label: string; detail: string }[] {
  if (rule.kind === 'chooseN') {
    return rule.of.map((b) => ({
      label: b.label,
      detail:
        b.kind === 'credits'
          ? `${b.n} credits from ${describeSet(b.from)}`
          : b.kind === 'course'
            ? b.code
            : b.kind === 'group'
              ? b.items.map((i) => (i.kind === 'course' ? i.code : i.label)).join(' + ')
              : '',
    }));
  }
  if (rule.kind === 'credits') {
    return [{ label: `${rule.n} credits`, detail: describeSet(rule.from) }];
  }
  return [];
}

/**
 * The credit load a program runs at, used when the student has not picked one.
 *
 * Fifteen credits is a standard term for a 120-credit degree — 30 a year, 120
 * over four years. Engineering is not that degree. A B.A.Sc. runs 148 to 158
 * credits, and at 15 a term it renders as a five-and-a-half-year plan when the
 * Calendar calls it four Winter Sessions at full credit load.
 *
 * The degree average alone is still not enough, because engineering years are
 * uneven: Civil totals 158 (a 20-credit average) but its SECOND YEAR is 45
 * credits, and since a year cannot start early, 20 leaves it spilling into a
 * ninth term.
 *
 * So the heaviest year sets the floor — but measured over REQUIRED courses
 * only. Elective buckets are split across years by us, not by the Calendar,
 * and counting them made Statistics look like a 48-credit year and asked for
 * 24 credits a term, which is both wrong and past the point where the solver
 * still produces a sane plan. Engineering has almost no free electives, so its
 * year weights are the Calendar's own and survive the filter intact.
 */
function defaultLoad(total: number, rules: Rule[], credits: Map<string, number>): number {
  const cost = (r: Rule): number => {
    if (r.constraint || r.elective) return 0;
    if (r.kind === 'credits') return r.n;
    if (r.kind === 'chooseN') return r.of[0] ? cost(r.of[0]) * r.n : 0;
    if (r.kind === 'group') return r.items.reduce((n, i) => n + cost(i), 0);
    return r.kind === 'course' ? (credits.get(r.code) ?? 3) : 0;
  };
  const perYear = new Map<number, number>();
  for (const rule of obligations(rules)) {
    if (rule.year) perYear.set(rule.year, (perYear.get(rule.year) ?? 0) + cost(rule));
  }
  // The heaviest-year floor applies only to degrees larger than a standard
  // four-year load. A 120-credit program already fits 15 a term, and applying
  // this reasoning to one anyway pushed Statistics to 21+, where the solver's
  // term-reserve logic comes apart and returns a three-term plan with half the
  // degree unplaced. Capped at 22 regardless — no real student takes more.
  const oversized = total > 130;
  const heaviest = oversized ? Math.max(0, ...perYear.values()) : 0;
  return Math.min(22, Math.max(15, Math.ceil(total / 8), Math.ceil(heaviest / 2)));
}

const STATE_STYLE: Record<string, string> = {
  satisfied: 'border-brand bg-brand text-brand-foreground',
  partial: 'border-border bg-surface-muted text-foreground',
  outstanding: 'border-border text-text-secondary',
  // A note is something to know, not something wrong. This used to carry the
  // danger palette, which turned the whole sidebar red — the Arts core alone
  // contributes ten notes, and a B.A. showed eleven red blocks against seven
  // ordinary rows. Informational blue instead: a lighter relative of the
  // brand navy, so it belongs to the same family without borrowing brand
  // blue's "selected" meaning.
  unevaluated: 'border-info-border bg-info-surface text-info',
};

export default async function GuidancePage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const program = getProgram(sp.program ?? DEFAULT_PROGRAM) ?? getProgram(DEFAULT_PROGRAM)!;
  const rules = effectiveRules(program);
  const useSummer = sp.summer === '1';

  const subjects = subjectsUsed(rules);

  const [catalogue, terms] = await Promise.all([loadCatalogue(subjects), loadTerms()]);
  const ids = catalogue.map((c) => c.id);
  const [prereqs, offerings] = await Promise.all([loadPrereqs(catalogue), loadOfferings(ids)]);

  const load = Math.min(
    24,
    Math.max(
      3,
      Number(sp.credits) ||
        defaultLoad(program.totalCredits, rules, new Map(catalogue.map((c) => [c.code, c.credits]))),
    ),
  );

  // No completion data yet — Enrollment records registration, not whether a
  // course was passed, so treating it as completed would be wrong in the
  // dangerous direction. Until grades are captured this plans a fresh start,
  // which is exactly the public roadmap a signed-out visitor should see.
  const completions: Completion[] = [];
  const plan = solve({
    outstanding: outstanding(completions, rules),
    completed: [],
    catalogue,
    prereqs,
    offerings,
    terms,
    prefs: { creditsPerTerm: load, useSummer, targetTermId: null },
  });

  // The checklist reads against the plan, not just against what is already
  // done. A required MATH or STAT course counts toward Science Breadth like
  // any other, so a plan that schedules them has met those categories — and
  // reporting "0 of 6" beside a plan that covers three of them is simply
  // wrong about its own output.
  const plannedCourses = plan.terms.flatMap((t) =>
    t.placements.flatMap((pl) => (pl.kind === 'course' ? [pl.course] : [])),
  );
  const checklist = progress(
    [...completions, ...plannedCourses.map((course) => ({ course, status: 'passed' as const }))],
    rules,
  );

  const totalRules = obligations(rules).filter((r) => r.kind !== 'note').length;
  // A note carries no completion state, so it belongs in its own list rather
  // than among rules a student can actually finish.
  const trackable = checklist.filter((p) => p.rule.kind !== 'note');
  const degreeRules = checklist.filter((p) => p.rule.kind === 'note');
  /** Year of the degree a term sits in — two winter terms to a year. */
  const yearOf = (i: number) => Math.floor(i / 2) + 1;
  const href = (over: Record<string, string | number>) => {
    const p = new URLSearchParams({
      program: program.code,
      credits: String(load),
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
                <span className="text-xs text-text-secondary">Credits per term</span>
                {[12, 15, 18].map((n) => (
                  <Link
                    key={n}
                    href={href({ credits: n })}
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
                {plan.terms.map((t, i) => (
                  <li key={t.term.id} className="rounded-card border border-border p-3">
                    <p className="flex flex-wrap items-baseline gap-2 text-xs font-semibold uppercase tracking-wide text-text-secondary">
                      <span className="rounded-pill bg-surface-muted px-2 py-0.5 text-foreground">
                        Year {yearOf(i)}
                      </span>
                      {t.term.name}
                      <span className="ml-auto font-normal normal-case opacity-70">
                        {t.placements.reduce(
                          (n, pl) => n + (pl.kind === 'course' ? pl.course.credits : pl.credits),
                          0,
                        )}{' '}
                        credits
                      </span>
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {t.placements.map((pl, i) =>
                        pl.kind === 'course' ? (
                          pl.alternatives.length === 0 ? (
                            <Link
                              key={pl.course.id}
                              href={courseHref(pl.course.code)}
                              className="rounded-pill border border-border bg-surface-muted px-3 py-1 text-sm font-medium text-foreground hover:border-brand hover:bg-brand hover:text-brand-foreground"
                            >
                              {pl.course.code}
                              <span className="ml-1.5 text-xs opacity-70">{pl.course.credits}cr</span>
                            </Link>
                          ) : (
                            // A requirement with alternatives is shown as one
                            // course, which reads as though that course were
                            // the requirement. The marker says a choice exists
                            // and opens the other routes rather than deciding
                            // silently for the student.
                            <details key={pl.course.id} className="group relative">
                              <summary className="cursor-pointer list-none rounded-pill border border-border bg-surface-muted px-3 py-1 text-sm font-medium text-foreground hover:border-brand">
                                {pl.course.code}
                                <span className="ml-1.5 text-xs opacity-70">{pl.course.credits}cr</span>
                                {/*
                                  Underlined and in the accent colour because
                                  it is the only thing on the chip you can act
                                  on. At 60% opacity in the body text colour it
                                  read as a footnote rather than a control, and
                                  a student had no reason to think MATH 104
                                  came with six other routes.
                                */}
                                <span className="ml-1.5 text-xs font-medium text-brand-accent underline decoration-dotted underline-offset-2 group-open:decoration-solid">
                                  or {pl.alternatives.length}
                                </span>
                              </summary>
                              <div className="absolute left-0 top-full z-20 mt-1 w-56 rounded-card border border-border bg-surface p-2 shadow-lg">
                                <p className="px-1 pb-1 text-xs text-text-secondary">
                                  Any one of these satisfies it:
                                </p>
                                <Link
                                  href={courseHref(pl.course.code)}
                                  className="block rounded px-1 py-0.5 text-xs font-medium text-foreground hover:bg-surface-muted"
                                >
                                  {pl.course.code} · planned
                                </Link>
                                {pl.alternatives.map((alt) => (
                                  <span key={alt} className="block">
                                    {alt.includes('+') ? (
                                      // "CPSC 103 + CPSC 107" — a pair, not a
                                      // single course, so it is not one link.
                                      <span className="block px-1 py-0.5 text-xs text-text-secondary">
                                        {alt}
                                      </span>
                                    ) : (
                                      <Link
                                        href={courseHref(alt)}
                                        className="block rounded px-1 py-0.5 text-xs text-text-secondary hover:bg-surface-muted hover:text-foreground"
                                      >
                                        {alt}
                                      </Link>
                                    )}
                                  </span>
                                ))}
                              </div>
                            </details>
                          )
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
          {/*
            Two lists, because they answer different questions. Trackable
            rules are work to do and can be ticked off; degree rules are
            conditions on how the whole degree is spent — residency, the
            outside requirement, credit caps — which no amount of course
            picking "completes". Mixing them made a B.A. look like it had
            thirty requirements when it has nineteen.
          */}
          <p className="text-sm font-semibold text-foreground">Requirements</p>
          <p className="mt-1 text-xs text-text-secondary">
            {totalRules} to complete · {program.totalCredits} credits total
          </p>

          <ul className="mt-3 space-y-1.5">
            {trackable.map((p) => {
              const parts = breakdown(p.rule);
              const body = (
                <>
                  <span className="font-medium">{p.rule.label}</span>
                  <span className="ml-1.5 opacity-80">{p.detail}</span>
                </>
              );
              return (
                <li
                  key={p.rule.id}
                  className={`rounded-card border px-3 py-2 text-xs ${STATE_STYLE[p.state]}`}
                >
                  {parts.length > 0 ? (
                    // A native disclosure — "any 6 of 7 categories" means
                    // nothing without the categories and what counts in each.
                    <details>
                      <summary className="cursor-pointer list-none">
                        {body}
                        <span className="mt-0.5 block text-[11px] opacity-60">see requirements</span>
                      </summary>
                      <ul className="mt-1.5 space-y-1 border-t border-current/20 pt-1.5 opacity-90">
                        {parts.map((part) => (
                          <li key={part.label}>
                            <span className="font-medium">{part.label}</span>
                            {part.detail && <span className="opacity-75"> — {part.detail}</span>}
                          </li>
                        ))}
                      </ul>
                      {p.rule.sourceUrl && (
                        <a
                          href={p.rule.sourceUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-1.5 inline-block underline opacity-70 hover:opacity-100"
                        >
                          UBC Calendar
                        </a>
                      )}
                    </details>
                  ) : (
                    body
                  )}
                </li>
              );
            })}
          </ul>

          {degreeRules.length > 0 && (
            <>
              <p className="mt-5 border-t border-border pt-4 text-sm font-semibold text-foreground">
                Degree rules
              </p>
              <p className="mt-1 text-xs text-text-secondary">{degreeRules.length} to know</p>
              <ul className="mt-3 space-y-1.5">
                {degreeRules.map((p) => (
                  <li
                    key={p.rule.id}
                    className={`rounded-card border px-3 py-2 text-xs ${STATE_STYLE[p.state]}`}
                  >
                    {/* Collapsed by default: these run to a paragraph each,
                        and expanded they buried the list above them. */}
                    <details>
                      <summary className="cursor-pointer list-none font-medium">
                        {p.rule.label}
                      </summary>
                      <p className="mt-1.5 border-t border-current/20 pt-1.5 opacity-90">
                        {p.detail}
                      </p>
                      {p.rule.sourceUrl && (
                        <a
                          href={p.rule.sourceUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-1.5 inline-block underline opacity-70 hover:opacity-100"
                        >
                          UBC Calendar
                        </a>
                      )}
                    </details>
                  </li>
                ))}
              </ul>
            </>
          )}
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
