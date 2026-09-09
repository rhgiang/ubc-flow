'use client';

import { useEffect, useRef, useState } from 'react';
import { generationData, type GenerationData } from '@/app/actions/generate';
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
  const poolKey = `${termId}|${[...courseIds].sort().join(',')}`;
  const poolKeyRef = useRef('');

  if (!open) return null;

  async function run() {
    setWorking(true);
    setError(null);
    setApplied(null);
    try {
      if (!dataRef.current || poolKeyRef.current !== poolKey) {
        dataRef.current = await generationData(termId, courseIds);
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
              : `Answer a few questions and every conflict-free timetable for your ${
                  courseIds.length > 1 ? `${courseIds.length} courses` : 'courses'
                } gets ranked to match.`}
          </p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {!result && (
            <div className="space-y-4">
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
            <button
              type="button"
              onClick={run}
              disabled={working || courseIds.length === 0}
              className="rounded-pill bg-brand px-4 py-1.5 text-sm font-medium text-brand-foreground hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              {working ? 'Building…' : result ? 'Regenerate' : 'Build my schedule'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
