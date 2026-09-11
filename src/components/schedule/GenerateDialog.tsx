'use client';

import { useEffect, useRef, useState } from 'react';
import {
  generationData,
  intakeOptions,
  plannedCoursesForTerm,
  type GenerationData,
} from '@/app/actions/generate';
import {
  generateSchedules,
  DEFAULT_PREFS,
  type GeneratePrefs,
  type GenerateResult,
} from '@/schedule/generate';
import type { SectionHit } from '@/lib/search';

/**
 * The smart builder's front door: a handful of plain questions, then the top
 * conflict-free timetables for the courses already in the builder, each with
 * the reasons it ranked where it did. Applying one swaps the builder's
 * sections; nothing is saved until the student presses Save themselves, so
 * trying options is free.
 *
 * The search runs right here in the browser — the server only hands over the
 * section pool and instructor signals in one round trip.
 */

/** One selectable chip; the whole questionnaire is rows of these. */
function Chip({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`rounded-pill border px-3 py-1.5 text-xs font-medium transition duration-150 ease-out hover:scale-[1.02] active:scale-100 ${
        active
          ? 'border-brand bg-brand text-brand-foreground'
          : 'border-border text-foreground hover:bg-surface-muted'
      }`}
    >
      {label}
    </button>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <fieldset>
      <legend className="text-xs font-medium text-text-secondary">{label}</legend>
      <div className="mt-1.5 flex flex-wrap gap-1.5">{children}</div>
    </fieldset>
  );
}

const EARLIEST: { value: number | null; label: string }[] = [
  { value: null, label: 'No preference' },
  { value: 9 * 60, label: 'After 9:00' },
  { value: 9 * 60 + 30, label: 'After 9:30' },
  { value: 10 * 60, label: 'After 10:00' },
  { value: 11 * 60, label: 'After 11:00' },
];

const LATEST: { value: number | null; label: string }[] = [
  { value: null, label: 'No preference' },
  { value: 15 * 60, label: 'By 3 pm' },
  { value: 17 * 60, label: 'By 5 pm' },
  { value: 18 * 60, label: 'By 6 pm' },
];

const WEEKDAYS = [
  { value: 0, label: 'Mon' },
  { value: 1, label: 'Tue' },
  { value: 2, label: 'Wed' },
  { value: 3, label: 'Thu' },
  { value: 4, label: 'Fri' },
];

/** "13:45" -> 825; null for empty/unparseable. */
function timeToMinutes(value: string): number | null {
  const m = value.match(/^(\d{1,2}):(\d{2})$/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** 825 -> "13:45", the value a native time input wants. */
function minutesToTime(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
}

/** 975 -> "4:15 pm", the way the preset chips speak. */
function fmt12(min: number): string {
  const h = Math.floor(min / 60);
  const mm = String(min % 60).padStart(2, '0');
  return `${((h + 11) % 12) + 1}:${mm} ${h < 12 ? 'am' : 'pm'}`;
}

/**
 * A chip that opens the browser's own time picker, for anyone the presets
 * don't fit ("after 12", "done by 4:15"). Looks and presses like every other
 * chip; the native input is invisible underneath and only supplies the
 * picker UI and the value. It reads as selected exactly when the stored
 * minutes match no preset — picking a preset clears it, picking a time
 * deselects the presets, and no third piece of state has to agree with two
 * others.
 */
function CustomTime({
  prefix,
  value,
  isCustom,
  onChange,
}: {
  /** "After" / "By" — so the selected chip reads like its preset siblings. */
  prefix: string;
  value: number | null;
  isCustom: boolean;
  onChange: (minutes: number | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const active = isCustom && value !== null;
  return (
    <div className="relative">
      <button
        type="button"
        aria-pressed={active}
        onClick={() => {
          const input = inputRef.current;
          if (!input) return;
          try {
            input.showPicker();
          } catch {
            input.focus();
          }
        }}
        className={`rounded-pill border px-3 py-1.5 text-xs font-medium transition duration-150 ease-out hover:scale-[1.02] active:scale-100 ${
          active
            ? 'border-brand bg-brand text-brand-foreground'
            : 'border-border text-foreground hover:bg-surface-muted'
        }`}
      >
        {active ? `${prefix} ${fmt12(value)}` : 'Custom'}
      </button>
      <input
        ref={inputRef}
        type="time"
        aria-hidden
        tabIndex={-1}
        value={active ? minutesToTime(value) : ''}
        onChange={(e) => onChange(timeToMinutes(e.target.value))}
        className="pointer-events-none absolute left-0 top-full h-px w-px opacity-0"
      />
    </div>
  );
}

export default function GenerateDialog({
  open,
  termId,
  courseIds,
  onApply,
  onClose,
}: {
  open: boolean;
  termId: string;
  /** The courses currently in the builder — what the generator builds from. */
  courseIds: string[];
  /** Replace the builder's chosen sections with a generated combination. */
  onApply: (sections: SectionHit[]) => void;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const [prefs, setPrefs] = useState<GeneratePrefs>(DEFAULT_PREFS);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<GenerateResult | null>(null);
  const [applied, setApplied] = useState<number | null>(null);
  // The fetched pool outlives one generation, so re-running with different
  // answers is instant — no second round trip.
  const dataRef = useRef<GenerationData | null>(null);

  // The from-scratch intake: an empty builder means there is nothing to
  // arrange yet, so the dialog first asks who the student is and takes the
  // term's courses from their degree's plan — the same list guidance's
  // "Arrange this term" button carries.
  const [options, setOptions] = useState<Awaited<ReturnType<typeof intakeOptions>> | null>(null);
  const [programCode, setProgramCode] = useState('');
  const [coopId, setCoopId] = useState<string | null>(null);
  const [year, setYear] = useState(1);
  const [creditsPerTerm, setCreditsPerTerm] = useState<number | null>(null);
  const [planning, setPlanning] = useState(false);
  const [plannedCourses, setPlannedCourses] = useState<{ id: string; code: string }[] | null>(
    null,
  );
  const [slots, setSlots] = useState<
    {
      label: string;
      credits: number;
      options: { id: string; code: string; credits: number }[];
      free: boolean;
    }[]
  >([]);
  // Electives the student picked to fill their slots — arranged alongside the
  // plan's named courses, which is what turns a one-course term into a week.
  const [extraCourseIds, setExtraCourseIds] = useState<string[]>([]);
  // Which slot has its full list open, and what is typed in its filter. One
  // at a time: the dialog is already a column of decisions.
  const [browsing, setBrowsing] = useState<number | null>(null);
  const [filter, setFilter] = useState('');
  const needsIntake = courseIds.length === 0 && plannedCourses === null;
  const effectiveCourseIds =
    courseIds.length > 0
      ? courseIds
      : [...(plannedCourses?.map((c) => c.id) ?? []), ...extraCourseIds];

  useEffect(() => {
    if (!open || courseIds.length > 0 || options) return;
    void intakeOptions().then(setOptions).catch(() => {});
  }, [open, courseIds.length, options]);

  function toggleExtra(id: string) {
    setExtraCourseIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  async function findCourses() {
    setPlanning(true);
    setError(null);
    try {
      const plan = await plannedCoursesForTerm(programCode, coopId, termId, {
        year,
        creditsPerTerm,
      });
      if ('error' in plan) {
        setError(plan.error);
      } else if (plan.workTerm) {
        setError("Under that co-op pattern this is a work term — there's nothing to schedule.");
      } else if (
        !plan.planned ||
        (plan.courses.length === 0 && plan.slots.every((s) => s.options.length === 0))
      ) {
        // Only a dead end when there is nothing to name AND nothing to offer.
        // A term that is all electives is the normal shape of third and fourth
        // year, and it is now the case the suggestions exist to serve.
        setError(
          "The degree plan doesn't put anything in this term. Try another term or year, or add courses by hand from Find Courses.",
        );
      } else {
        setPlannedCourses(plan.courses);
        setSlots(plan.slots);
      }
    } catch {
      setError('Something went wrong reading the degree plan. Try again.');
    } finally {
      setPlanning(false);
    }
  }

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      // Capture + stopImmediatePropagation, same reason as the other builder
      // dialogs: several of them listen on `document` and one Escape must not
      // close two layers at once.
      e.stopImmediatePropagation();
      onClose();
    }
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [open, onClose]);

  useEffect(() => {
    if (open) {
      dialogRef.current?.focus();
      // A reopened dialog starts at the questions with last time's answers —
      // the pool cache is keyed to term+courses below, not kept blindly.
      setResult(null);
      setApplied(null);
      setError(null);
    }
  }, [open]);

  // The cached pool is only valid for the courses it was fetched for.
  const poolKey = `${termId}|${[...effectiveCourseIds].sort().join(',')}`;
  const poolKeyRef = useRef('');

  if (!open) return null;

  async function run() {
    setWorking(true);
    setError(null);
    setApplied(null);
    try {
      if (!dataRef.current || poolKeyRef.current !== poolKey) {
        dataRef.current = await generationData(termId, effectiveCourseIds);
        poolKeyRef.current = poolKey;
      }
      const { sections, profScores } = dataRef.current;
      setResult(generateSchedules(sections, prefs, profScores));
    } catch {
      setError('Something went wrong building schedules. Try again.');
    } finally {
      setWorking(false);
    }
  }

  function apply(index: number) {
    const chosen = result?.schedules[index];
    const pool = dataRef.current?.sections;
    if (!chosen || !pool) return;
    const byId = new Map(pool.map((s) => [s.sectionId, s]));
    onApply(chosen.sectionIds.map((id) => byId.get(id)!).filter(Boolean));
    setApplied(index);
  }

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50 p-4"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Flow Builder: build a schedule from your preferences"
        className="flex max-h-[85dvh] w-full max-w-lg flex-col rounded-card border border-border bg-background"
      >
        <div className="border-b border-border px-5 py-3">
          <p className="text-sm font-semibold text-foreground">Flow Builder</p>
          <p className="mt-0.5 text-xs text-text-tertiary">
            {result
              ? 'Pick an option to load it into the builder — nothing is saved until you press Save.'
              : needsIntake
                ? "Starting from scratch? Say what you're studying and Flow Builder takes this term's courses from your degree's suggested plan."
                : `Answer a few questions and every conflict-free timetable for your ${
                    effectiveCourseIds.length > 1
                      ? `${effectiveCourseIds.length} courses`
                      : 'courses'
                  } gets ranked to match.`}
          </p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {!result && needsIntake && (
            <div className="space-y-4">
              <fieldset>
                <legend className="text-xs font-medium text-text-secondary">
                  What are you studying?
                </legend>
                <select
                  value={programCode}
                  onChange={(e) => setProgramCode(e.target.value)}
                  className="mt-1.5 w-full rounded-input border border-border bg-surface px-3 py-2 text-sm text-foreground focus:border-foreground focus:outline-none"
                >
                  <option value="">Pick your program…</option>
                  {options?.programs.map((g) => (
                    <optgroup key={g.degree} label={`${g.degree} · ${g.faculty}`}>
                      {g.programs.map((p) => (
                        <option key={p.code} value={p.code}>
                          {p.name}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </fieldset>

              <Row label="What year will you be in?">
                {[1, 2, 3, 4, 5].map((y) => (
                  <Chip
                    key={y}
                    active={year === y}
                    label={
                      y === 1 ? '1st (incoming)' : `${y}${['th', 'st', 'nd', 'rd'][y % 10] ?? 'th'}`
                    }
                    onClick={() => setYear(y)}
                  />
                ))}
              </Row>

              <Row label="How heavy a term?">
                <Chip
                  active={creditsPerTerm === null}
                  label="Standard for my program"
                  onClick={() => setCreditsPerTerm(null)}
                />
                {[12, 15, 18].map((c) => (
                  <Chip
                    key={c}
                    active={creditsPerTerm === c}
                    label={`${c} credits`}
                    onClick={() => setCreditsPerTerm(c)}
                  />
                ))}
              </Row>

              <Row label="Co-op?">
                <Chip active={coopId === null} label="No co-op" onClick={() => setCoopId(null)} />
                {options?.coops.map((c) => (
                  <Chip
                    key={c.id}
                    active={coopId === c.id}
                    label={c.label}
                    onClick={() => setCoopId(c.id)}
                  />
                ))}
              </Row>

              <p className="text-xs text-text-tertiary">
                Signed in with your Workday record uploaded, the plan starts from the courses
                you&apos;ve actually finished and your year answer is only a fallback. Either
                way you can add or drop courses by hand afterwards.
              </p>
            </div>
          )}

          {!result && !needsIntake && (
            <div className="space-y-4">
              {courseIds.length === 0 && plannedCourses && (
                <div className="rounded-card border border-border bg-surface-muted p-3">
                  <p className="text-xs font-medium text-text-secondary">
                    {plannedCourses.length > 0
                      ? 'Arranging from your degree plan:'
                      : 'Your plan names no fixed courses this term — it is all your choice:'}
                  </p>
                  {plannedCourses.length > 0 && (
                    <p className="mt-1 text-sm text-foreground">
                      {plannedCourses.map((c) => c.code).join(' · ')}
                    </p>
                  )}
                  {/*
                    Named after what they are, with examples: "1 elective slot"
                    told a student nothing, and a term that hands over one
                    course plus three invisible slots reads as broken rather
                    than as a term that is mostly their own choice.
                  */}
                  {slots.length > 0 && (
                    <div className="mt-2 border-t border-border pt-2">
                      <p className="text-xs text-text-secondary">
                        The rest of this term is yours to choose. Pick any of these and
                        they&apos;ll be arranged too — all offered this term, with the
                        prerequisites you&apos;ll have by then.
                      </p>
                      <div className="mt-1.5 space-y-2">
                        {slots.map((s, i) => (
                          <div key={`${s.label}-${i}`}>
                            <p className="text-xs font-medium text-text-tertiary">
                              {s.credits}cr · {s.label}
                            </p>
                            {s.options.length === 0 ? (
                              <p className="mt-0.5 text-xs text-text-tertiary opacity-70">
                                Nothing offered this term fits this one — add it from Find
                                Courses.
                              </p>
                            ) : (
                              <div className="mt-1 flex flex-wrap items-center gap-1">
                                {/* The most-taken few as chips; everything else
                                    lives behind the list, for the student who
                                    already knows what they want. */}
                                {s.options.slice(0, 6).map((o) => (
                                  <Chip
                                    key={o.id}
                                    active={extraCourseIds.includes(o.id)}
                                    label={o.code}
                                    onClick={() => toggleExtra(o.id)}
                                  />
                                ))}
                                {/* A course picked from the list keeps its chip
                                    even when it is not in the top few, or
                                    unticking it would mean hunting for it. */}
                                {s.options
                                  .slice(6)
                                  .filter((o) => extraCourseIds.includes(o.id))
                                  .map((o) => (
                                    <Chip
                                      key={o.id}
                                      active
                                      label={o.code}
                                      onClick={() => toggleExtra(o.id)}
                                    />
                                  ))}
                                <button
                                  type="button"
                                  onClick={() => {
                                    setFilter('');
                                    setBrowsing(browsing === i ? null : i);
                                  }}
                                  className="rounded-pill border border-dashed border-border px-3 py-1.5 text-xs font-medium text-brand-accent hover:bg-surface-muted"
                                >
                                  {browsing === i ? 'Close list' : 'Browse all ' + s.options.length}
                                </button>
                              </div>
                            )}

                            {browsing === i && (
                              <div className="mt-1.5 rounded-card border border-border bg-background p-2">
                                <input
                                  value={filter}
                                  onChange={(e) => setFilter(e.target.value)}
                                  placeholder="Filter by code, e.g. PSYC"
                                  aria-label="Filter courses"
                                  className="w-full rounded-input border border-border bg-surface px-2 py-1 text-xs text-foreground placeholder:text-text-tertiary focus:border-foreground focus:outline-none"
                                />
                                <div className="mt-1.5 max-h-44 overflow-y-auto">
                                  {s.options
                                    .filter((o) =>
                                      o.code.toLowerCase().includes(filter.trim().toLowerCase()),
                                    )
                                    .map((o) => {
                                      const picked = extraCourseIds.includes(o.id);
                                      return (
                                        <button
                                          key={o.id}
                                          type="button"
                                          aria-pressed={picked}
                                          onClick={() => toggleExtra(o.id)}
                                          className={
                                            'flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-xs hover:bg-surface-muted ' +
                                            (picked ? 'text-brand-accent' : 'text-foreground')
                                          }
                                        >
                                          <span>{o.code}</span>
                                          <span className="opacity-70">
                                            {picked ? 'Added' : o.credits + 'cr'}
                                          </span>
                                        </button>
                                      );
                                    })}
                                </div>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => setPlannedCourses(null)}
                    className="mt-1.5 text-xs font-medium text-brand-accent underline decoration-dotted underline-offset-2 hover:decoration-solid"
                  >
                    Change program
                  </button>
                </div>
              )}
              <Row label="Earliest class you'll take?">
                {EARLIEST.map((o) => (
                  <Chip
                    key={String(o.value)}
                    active={prefs.earliest === o.value}
                    label={o.label}
                    onClick={() => setPrefs((p) => ({ ...p, earliest: o.value }))}
                  />
                ))}
                <CustomTime
                  prefix="After"
                  value={prefs.earliest}
                  isCustom={!EARLIEST.some((o) => o.value === prefs.earliest)}
                  onChange={(minutes) => setPrefs((p) => ({ ...p, earliest: minutes }))}
                />
              </Row>

              <Row label="When should your day be over?">
                {LATEST.map((o) => (
                  <Chip
                    key={String(o.value)}
                    active={prefs.latest === o.value}
                    label={o.label}
                    onClick={() => setPrefs((p) => ({ ...p, latest: o.value }))}
                  />
                ))}
                <CustomTime
                  prefix="By"
                  value={prefs.latest}
                  isCustom={!LATEST.some((o) => o.value === prefs.latest)}
                  onChange={(minutes) => setPrefs((p) => ({ ...p, latest: minutes }))}
                />
              </Row>

              <Row label="Any days you'd love to keep free? (pick any)">
                {WEEKDAYS.map((d) => (
                  <Chip
                    key={d.value}
                    active={prefs.freeDays.includes(d.value)}
                    label={d.label}
                    onClick={() =>
                      setPrefs((p) => ({
                        ...p,
                        freeDays: p.freeDays.includes(d.value)
                          ? p.freeDays.filter((x) => x !== d.value)
                          : [...p.freeDays, d.value],
                      }))
                    }
                  />
                ))}
              </Row>

              <Row label="Gaps between classes?">
                <Chip
                  active={prefs.rhythm === 'compact'}
                  label="Pack them together"
                  onClick={() => setPrefs((p) => ({ ...p, rhythm: 'compact' }))}
                />
                <Chip
                  active={prefs.rhythm === 'lunch'}
                  label="Packed, but keep lunch free"
                  onClick={() => setPrefs((p) => ({ ...p, rhythm: 'lunch' }))}
                />
                <Chip
                  active={prefs.rhythm === 'spread'}
                  label="I like breaks"
                  onClick={() => setPrefs((p) => ({ ...p, rhythm: 'spread' }))}
                />
                <Chip
                  active={prefs.rhythm === 'whatever'}
                  label="No preference"
                  onClick={() => setPrefs((p) => ({ ...p, rhythm: 'whatever' }))}
                />
              </Row>

              <Row label="Days on campus?">
                <Chip
                  active={prefs.fewerDays}
                  label="As few as possible"
                  onClick={() => setPrefs((p) => ({ ...p, fewerDays: true }))}
                />
                <Chip
                  active={!prefs.fewerDays}
                  label="No preference"
                  onClick={() => setPrefs((p) => ({ ...p, fewerDays: false }))}
                />
              </Row>

              <Row label="Do professors matter?">
                <Chip
                  active={prefs.bestProfs}
                  label="Get me the best-rated"
                  onClick={() => setPrefs((p) => ({ ...p, bestProfs: true }))}
                />
                <Chip
                  active={!prefs.bestProfs}
                  label="No preference"
                  onClick={() => setPrefs((p) => ({ ...p, bestProfs: false }))}
                />
              </Row>
            </div>
          )}

          {result && (
            <div className="space-y-3">
              {(dataRef.current?.missing.length ?? 0) > 0 && (
                <p className="rounded-card border border-info-border bg-info-surface px-3 py-2 text-xs text-info">
                  {dataRef.current!.missing.map((m) => m.code).join(', ')}{' '}
                  {dataRef.current!.missing.length === 1 ? 'has' : 'have'} no sections this term,
                  so {dataRef.current!.missing.length === 1 ? "it isn't" : "they aren't"} in these
                  options.
                </p>
              )}

              {result.unplaceable.length > 0 && (
                <p className="rounded-card border border-danger-border bg-danger-surface px-3 py-2 text-xs text-danger">
                  {result.unplaceable.join(', ')}{' '}
                  {result.unplaceable.length === 1 ? 'has' : 'have'} no workable section
                  combination this term, so the options below leave{' '}
                  {result.unplaceable.length === 1 ? 'it' : 'them'} out.
                </p>
              )}

              {result.schedules.length === 0 ? (
                <p className="text-sm text-text-secondary">
                  No conflict-free combination exists for all of these courses. Try removing
                  one and generating again.
                </p>
              ) : (
                result.schedules.map((s, i) => (
                  <div
                    key={s.sectionIds.join()}
                    className={`rounded-card border p-3 ${
                      applied === i ? 'border-brand' : 'border-border'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium text-foreground">Option {i + 1}</p>
                      <button
                        type="button"
                        onClick={() => apply(i)}
                        className={`rounded-pill px-3 py-1 text-xs font-medium transition duration-150 ease-out hover:scale-[1.03] active:scale-100 ${
                          applied === i
                            ? 'bg-brand text-brand-foreground'
                            : 'border border-border text-foreground hover:bg-surface-muted'
                        }`}
                      >
                        {applied === i ? 'In the builder' : 'Use this one'}
                      </button>
                    </div>
                    {/* The sections themselves, not just the shape of the
                        week: applying an option WAS a leap of faith about
                        which lecture and lab you were agreeing to. */}
                    <p className="mt-1 text-xs text-foreground">
                      {s.sectionIds
                        .map((id) => {
                          const hit = dataRef.current?.sections.find(
                            (x) => x.sectionId === id,
                          );
                          return hit ? `${hit.code} ${hit.sectionCode}` : null;
                        })
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                    <ul className="mt-1.5 space-y-0.5 text-xs text-text-secondary">
                      {s.notes.map((n) => (
                        <li key={n}>{n}</li>
                      ))}
                    </ul>
                  </div>
                ))
              )}

              {result.truncated && (
                <p className="text-xs text-text-tertiary">
                  These courses have a huge number of combinations, so this ranking covers a
                  large sample rather than every last one.
                </p>
              )}
            </div>
          )}

          {error && <p className="mt-3 text-xs text-danger">{error}</p>}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-border px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-pill border border-border px-4 py-1.5 text-sm font-medium text-foreground hover:bg-surface-muted"
          >
            {applied !== null ? 'Done' : 'Close'}
          </button>
          <div className="flex gap-2">
            {result && (
              <button
                type="button"
                onClick={() => setResult(null)}
                className="rounded-pill border border-border px-4 py-1.5 text-sm font-medium text-foreground hover:bg-surface-muted"
              >
                Change answers
              </button>
            )}
            {needsIntake ? (
              <button
                type="button"
                onClick={findCourses}
                disabled={planning || programCode === ''}
                className="rounded-pill bg-brand px-4 py-1.5 text-sm font-medium text-brand-foreground hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-50"
              >
                {planning ? 'Reading your degree plan…' : 'Find my courses'}
              </button>
            ) : (
              <button
                type="button"
                onClick={run}
                disabled={working || effectiveCourseIds.length === 0}
                className="rounded-pill bg-brand px-4 py-1.5 text-sm font-medium text-brand-foreground hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-50"
              >
                {working ? 'Building…' : result ? 'Regenerate' : 'Build my schedule'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
