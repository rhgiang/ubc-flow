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

type Question = {
  key: keyof GeneratePrefs;
  label: string;
  options: { value: GeneratePrefs[keyof GeneratePrefs]; label: string }[];
};

const QUESTIONS: Question[] = [
  {
    key: 'mornings',
    label: 'How do you feel about mornings?',
    options: [
      { value: 'no-early', label: 'Nothing before 9:30' },
      { value: 'early-bird', label: 'Start early, finish early' },
      { value: 'whatever', label: 'No preference' },
    ],
  },
  {
    key: 'rhythm',
    label: 'Gaps between classes?',
    options: [
      { value: 'compact', label: 'Pack them together' },
      { value: 'spread', label: 'I like breaks' },
      { value: 'whatever', label: 'No preference' },
    ],
  },
  {
    key: 'fewerDays',
    label: 'Days on campus?',
    options: [
      { value: true, label: 'As few as possible' },
      { value: false, label: 'No preference' },
    ],
  },
  {
    key: 'bestProfs',
    label: 'Do professors matter?',
    options: [
      { value: true, label: 'Get me the best-rated' },
      { value: false, label: 'No preference' },
    ],
  },
  {
    key: 'noEvenings',
    label: 'Evening classes?',
    options: [
      { value: true, label: 'Avoid them' },
      { value: false, label: "They're fine" },
    ],
  },
];

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
        aria-label="Auto-build a schedule"
        className="flex max-h-[85dvh] w-full max-w-lg flex-col rounded-card border border-border bg-background"
      >
        <div className="border-b border-border px-5 py-3">
          <p className="text-sm font-semibold text-foreground">Auto-build your week</p>
          <p className="mt-0.5 text-xs text-text-tertiary">
            {result
              ? 'Pick an option to load it into the builder — nothing is saved until you press Save.'
              : 'Answer a few questions and every conflict-free timetable for your courses gets ranked to match.'}
          </p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {!result && (
            <div className="space-y-4">
              {QUESTIONS.map((q) => (
                <fieldset key={q.key}>
                  <legend className="text-xs font-medium text-text-secondary">{q.label}</legend>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {q.options.map((o) => {
                      const active = prefs[q.key] === o.value;
                      return (
                        <button
                          key={String(o.value)}
                          type="button"
                          aria-pressed={active}
                          onClick={() => setPrefs((p) => ({ ...p, [q.key]: o.value }))}
                          className={`rounded-pill border px-3 py-1.5 text-xs font-medium transition duration-150 ease-out hover:scale-[1.02] active:scale-100 ${
                            active
                              ? 'border-brand bg-brand text-brand-foreground'
                              : 'border-border text-foreground hover:bg-surface-muted'
                          }`}
                        >
                          {o.label}
                        </button>
                      );
                    })}
                  </div>
                </fieldset>
              ))}
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
