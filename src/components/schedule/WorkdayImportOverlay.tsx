'use client';

import { useEffect, useState } from 'react';
import { parseWorkdayForSchedule, type ImportResult } from '@/app/actions/import';
import type { SectionHit } from '@/lib/search';

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
}: {
  open: boolean;
  onClose: () => void;
  onImport: (termId: string, sections: SectionHit[]) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Loaded | null>(null);

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
      setError(null);
      setBusy(false);
    }
  }, [open]);

  if (!open) return null;

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await parseWorkdayForSchedule(new FormData(e.currentTarget));
      if (!res.ok) setError(res.error);
      else setResult(res);
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
      className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/50 px-6 py-10 backdrop-blur-sm"
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
              <li>1. In Workday, go to <span className="font-medium text-foreground">Academics → View My Courses</span>.</li>
              <li>2. Click the <span className="font-medium text-foreground">Export to Excel</span> icon above the table.</li>
              <li>3. Upload the <code>.xlsx</code> file here.</li>
            </ol>

            <form onSubmit={onSubmit} className="mt-5 flex flex-wrap items-center gap-3">
              <input
                type="file"
                name="file"
                accept=".xlsx"
                required
                aria-label="Workday export file"
                className="flex-1 rounded-input border border-border bg-background px-3 py-2 text-sm text-foreground"
              />
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

        {error && <p className="mt-4 text-sm text-danger">{error}</p>}

        {result && (
          <>
            <p className="mt-4 text-sm text-foreground">
              Found <span className="font-medium">{result.matched.length}</span> section
              {result.matched.length === 1 ? '' : 's'} for{' '}
              <span className="font-medium">{result.termName}</span>.
            </p>

            <SkipList title="Not in our catalogue" items={result.unmatched} />
            <SkipList title="A different term — a schedule covers one term" items={result.otherTerm} />

            {result.skipped.length > 0 && (
              <div className="mt-3">
                <p className="text-xs font-medium text-foreground">Skipped</p>
                <ul className="mt-1 space-y-0.5">
                  {result.skipped.map((s) => (
                    <li key={s.raw} className="text-xs text-text-secondary">
                      {s.raw} — {s.reason}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-pill border border-border px-5 py-2 text-sm font-medium text-foreground transition-colors hover:bg-surface-muted"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={result.matched.length === 0}
                onClick={() => {
                  onImport(result.termId, result.matched);
                  onClose();
                }}
                className="rounded-pill bg-brand px-5 py-2 text-sm font-medium text-brand-foreground transition-colors hover:bg-brand-hover disabled:opacity-50"
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
