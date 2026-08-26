'use client';

import { useEffect, useState } from 'react';
import { parseWorkdayForSchedule, type ImportResult, type SkippedRow } from '@/app/actions/import';
import type { ImportedTerm } from '@/upload/match-schedule';
import { UBC_WORKDAY_URL } from '@/lib/links';

type Loaded = Extract<ImportResult, { ok: true }>;

function SkipList({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div className="mt-3">
      <p className="text-xs font-medium text-foreground">{title}</p>
      <ul className="mt-1 space-y-0.5">
        {items.map((i) => (
          <li key={i} className="text-xs text-text-secondary">
            {i}
          </li>
        ))}
      </ul>
    </div>
  );
}

function SkippedRowsList({ items }: { items: SkippedRow[] }) {
  if (items.length === 0) return null;
  return (
    <div className="mt-3">
      <p className="text-xs font-medium text-foreground">Skipped</p>
      <ul className="mt-1 space-y-0.5">
        {items.map((s) => (
          <li key={s.raw} className="text-xs text-text-secondary">
            {s.raw} — {s.reason}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Loads a student's real timetable from their Workday export.
 *
 * Nothing is written by this flow — the sections land in the builder's buffer
 * and are only persisted if the student then saves the schedule.
 */
export default function WorkdayImportOverlay({
  open,
  onClose,
  onImport,
  plannableTermIds,
}: {
  open: boolean;
  onClose: () => void;
  /** `otherTerms` carries the terms the student did NOT load, so the builder
   *  can offer to create schedules for them once this one is saved. */
  onImport: (term: ImportedTerm, otherTerms: ImportedTerm[]) => void;
  /** Terms a schedule can actually be built for. A past term parses fine and
   *  is still refused here, where the reason can be shown, rather than after
   *  the student has been sent to a builder that cannot hold it. */
  plannableTermIds: string[];
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorSkipped, setErrorSkipped] = useState<SkippedRow[]>([]);
  const [result, setResult] = useState<Loaded | null>(null);
  /** Which term gets loaded into the builder now. Defaults to the one with
   *  the most sections, which matchWorkdayRows sorts first. */
  const [chosenTermId, setChosenTermId] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const chosenTerm = result?.terms.find((t) => t.termId === chosenTermId) ?? null;
  // Why "Add to schedule" is off, in the order the student can act on: an
  // unplannable term is a dead end, no matches means nothing to add.
  const blocked = !chosenTerm
    ? null
    : !plannableTermIds.includes(chosenTerm.termId)
      ? `${chosenTerm.termName} isn't a term you can build a schedule for yet, so nothing can be added from it.`
      : chosenTerm.matched.length === 0
        ? `None of the courses in ${chosenTerm.termName} matched our catalogue, so there is nothing to add.`
        : null;

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // A fresh open starts clean rather than showing the last import's summary.
  useEffect(() => {
    if (open) {
      setResult(null);
      setChosenTermId(null);
      setFileName(null);
      setError(null);
      setErrorSkipped([]);
      setBusy(false);
    }
  }, [open]);

  if (!open) return null;

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    // Checked here rather than with `required`: the real input is visually
    // hidden behind its label, and browsers will not show a validation bubble
    // on a control they cannot focus.
    if (!fileName) {
      setError('Choose your Workday export first.');
      return;
    }
    setBusy(true);
    setError(null);
    setErrorSkipped([]);
    try {
      const res = await parseWorkdayForSchedule(new FormData(e.currentTarget));
      if (!res.ok) {
        setError(res.error);
        setErrorSkipped(res.skipped ?? []);
      } else {
        setResult(res);
        // Preselect the term with the most sections (first, post-sort).
        setChosenTermId(res.terms[0]?.termId ?? null);
      }
    } catch {
      setError('Could not read that file. Try exporting it from Workday again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Import from Workday"
      className="fixed inset-0 z-[60] flex items-start justify-center overlay-below-nav overflow-y-auto bg-black/50 px-6 pb-10 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-lg rounded-card border border-border-hairline bg-surface p-6 shadow-lg">
        <div className="flex items-start justify-between gap-4">
          <h2 className="text-xl font-semibold text-foreground">Import from Workday</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded-full p-1 text-text-secondary hover:bg-surface-muted hover:text-foreground"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="h-5 w-5">
              <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {!result && (
          <>
            <ol className="mt-4 space-y-1.5 text-sm text-text-secondary">
              <li>
                1. In{' '}
                <a
                  href={UBC_WORKDAY_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium text-brand-accent hover:underline"
                >
                  Workday ↗
                </a>
                , go to{' '}
                <span className="font-medium text-foreground">
                  Student → Academics → Registration &amp; Courses → View My Courses
                </span>
                .
              </li>
              <li>2. Click the <span className="font-medium text-foreground">Export to Excel</span> icon above the table.</li>
              <li>3. Upload the <code>.xlsx</code> file here.</li>
            </ol>

            <form onSubmit={onSubmit} className="mt-5 flex flex-wrap items-center gap-3">
              {/* Same reasoning as the onboarding upload form: the native
                  control's own button plus its "no file chosen" label read as
                  two controls inside one styled box. */}
              <label className="flex flex-1 cursor-pointer items-center gap-2 rounded-input border border-border bg-background px-3 py-2 text-sm transition-colors duration-150 ease-out hover:border-foreground hover:bg-surface-muted focus-within:border-foreground focus-within:bg-surface-muted">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.75}
                  aria-hidden
                  className="h-4 w-4 shrink-0 text-text-tertiary"
                >
                  <path d="M12 16V4m0 0L8 8m4-4 4 4" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" strokeLinecap="round" />
                </svg>
                <span className={`truncate ${fileName ? 'text-foreground' : 'text-text-tertiary'}`}>
                  {fileName ?? 'Choose your .xlsx export'}
                </span>
                <input
                  type="file"
                  name="file"
                  accept=".xlsx"
                  aria-label="Workday export file"
                  // Cleared on every open, so re-picking the SAME file still fires
                  // change. Without this a second upload of one file is silently
                  // ignored — the browser treats an identical selection as no change,
                  // and the box goes on saying no file is chosen.
                  onClick={(e) => {
                    e.currentTarget.value = '';
                    setFileName(null);
                  }}
                  onChange={(e) => setFileName(e.target.files?.[0]?.name ?? null)}
                  className="sr-only"
                />
              </label>
              <button
                type="submit"
                disabled={busy}
                className="rounded-pill bg-brand px-5 py-2 text-sm font-medium text-brand-foreground transition duration-150 ease-out hover:scale-[1.02] hover:bg-brand-hover active:scale-100 disabled:opacity-50 disabled:hover:scale-100"
              >
                {busy ? 'Reading…' : 'Import'}
              </button>
            </form>

            <p className="mt-4 text-xs text-text-tertiary">
              Nothing is saved by importing. Your file is read in memory and never stored, and
              the sections only become a schedule if you save it.
            </p>
          </>
        )}

        {error && (
          <>
            <p className="mt-4 text-sm text-danger">{error}</p>
            <SkippedRowsList items={errorSkipped} />
          </>
        )}

        {result && (
          <>
            {result.terms.length > 1 ? (
              <p className="mt-4 text-sm text-foreground">
                That export covers <span className="font-medium">{result.terms.length} terms</span>.
                A schedule holds one term — pick which to build now, and you can create the
                other right after you save.
              </p>
            ) : (
              <p className="mt-4 text-sm text-foreground">
                Found <span className="font-medium">{result.terms[0]?.matched.length ?? 0}</span>{' '}
                section{result.terms[0]?.matched.length === 1 ? '' : 's'} for{' '}
                <span className="font-medium">{result.terms[0]?.termName}</span>.
              </p>
            )}

            <div className="mt-3 space-y-2">
              {result.terms.map((t) => (
                <label
                  key={t.termId}
                  className={`flex cursor-pointer items-center gap-3 rounded-card border p-3 transition-colors ${
                    chosenTermId === t.termId
                      ? 'border-brand bg-surface-muted'
                      : 'border-border hover:bg-surface-muted'
                  }`}
                >
                  <input
                    type="radio"
                    name="importTerm"
                    checked={chosenTermId === t.termId}
                    onChange={() => setChosenTermId(t.termId)}
                    className="accent-brand"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-foreground">{t.termName}</span>
                    <span className="block text-xs text-text-secondary">
                      {t.matched.length} section{t.matched.length === 1 ? '' : 's'}
                      {t.unmatched.length > 0 && `, ${t.unmatched.length} not matched`}
                    </span>
                  </span>
                </label>
              ))}
            </div>

            {blocked && <p className="mt-3 text-sm text-danger">{blocked}</p>}

            {chosenTerm && chosenTerm.unmatched.length > 0 && (
              <p className="mt-3 text-xs text-danger">
                {chosenTerm.unmatched.length} course
                {chosenTerm.unmatched.length === 1 ? '' : 's'} in that export could not be
                matched and will not be added:
              </p>
            )}
            {chosenTerm && <SkipList title="Not in our catalogue" items={chosenTerm.unmatched} />}
            <SkipList title="Term not in our catalogue" items={result.unknownTerm} />

            <SkippedRowsList items={result.skipped} />

            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-pill border border-border px-5 py-2 text-sm font-medium text-foreground transition duration-150 ease-out hover:scale-[1.02] hover:bg-surface-muted active:scale-100"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!chosenTerm || blocked !== null}
                onClick={() => {
                  if (!chosenTerm || blocked !== null) return;
                  onImport(
                    chosenTerm,
                    result.terms.filter((t) => t.termId !== chosenTerm.termId),
                  );
                  onClose();
                }}
                className="rounded-pill bg-brand px-5 py-2 text-sm font-medium text-brand-foreground transition duration-150 ease-out hover:scale-[1.02] hover:bg-brand-hover active:scale-100 disabled:opacity-50 disabled:hover:scale-100"
              >
                Add to schedule
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
