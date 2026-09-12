'use client';

import { useState } from 'react';
import { ASSESSMENT_KINDS, type AssessmentKind, type ExtractedAssessment } from '@/syllabus/schema';

type Row = ExtractedAssessment & { edited: boolean };

function rowChanged(a: ExtractedAssessment, b: ExtractedAssessment): boolean {
  return a.title !== b.title || a.kind !== b.kind || a.date !== b.date
    || a.startTime !== b.startTime || a.weight !== b.weight;
}

/**
 * The confirm screen from the design doc's §8 "human in the loop" — extracted
 * rows are proposals only. Every row keeps its verbatim `quote` and `page`
 * visible beside it: that quote is the only way to check the model against
 * the actual PDF, so it is never hidden behind a toggle or dropped.
 * Nothing is written until Save.
 */
export default function AssessmentConfirm({
  syllabusId,
  alreadyExtracted,
  onSaved,
}: {
  syllabusId: string;
  alreadyExtracted: boolean;
  onSaved: () => void;
}) {
  const [status, setStatus] = useState<'idle' | 'loading' | 'review' | 'saving'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [original, setOriginal] = useState<ExtractedAssessment[]>([]);
  const [rows, setRows] = useState<Row[]>([]);

  async function runExtraction() {
    setStatus('loading');
    setError(null);
    try {
      const res = await fetch('/api/syllabus/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ syllabusId }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error ?? 'Could not read this syllabus. Try again in a moment.');
        setStatus('idle');
        return;
      }
      const extracted: ExtractedAssessment[] = data.assessments ?? [];
      setOriginal(extracted);
      setRows(extracted.map((a) => ({ ...a, edited: false })));
      setStatus('review');
    } catch {
      setError('Could not read this syllabus. Check your connection and try again.');
      setStatus('idle');
    }
  }

  function updateRow(i: number, patch: Partial<ExtractedAssessment>) {
    setRows((prev) => prev.map((row, idx) => {
      if (idx !== i) return row;
      const next = { ...row, ...patch };
      return { ...next, edited: rowChanged(next, original[i]) };
    }));
  }

  function removeRow(i: number) {
    setRows((prev) => prev.filter((_, idx) => idx !== i));
    setOriginal((prev) => prev.filter((_, idx) => idx !== i));
  }

  async function save() {
    setStatus('saving');
    setError(null);
    try {
      const res = await fetch(`/api/syllabus/${syllabusId}/assessments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assessments: rows }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(data?.error ?? 'Could not save these assessments. Try again in a moment.');
        setStatus('review');
        return;
      }
      setStatus('idle');
      setRows([]);
      setOriginal([]);
      onSaved();
    } catch {
      setError('Could not save. Check your connection and try again.');
      setStatus('review');
    }
  }

  if (status === 'idle') {
    return (
      <div className="mt-3">
        <button
          type="button"
          onClick={runExtraction}
          className="rounded-pill bg-surface-muted px-4 py-1.5 text-sm font-medium text-foreground transition duration-150 ease-out hover:scale-[1.02] active:scale-100"
        >
          {alreadyExtracted ? 'Re-read assessments' : 'Read assessments from this syllabus'}
        </button>
        {error && <p role="alert" className="mt-2 text-sm text-danger">{error}</p>}
      </div>
    );
  }

  if (status === 'loading') {
    return (
      <p className="mt-3 text-sm text-text-secondary">
        Reading the syllabus&hellip; this can take up to 15 seconds.
      </p>
    );
  }

  return (
    <div className="mt-4 space-y-3">
      <p className="text-sm text-text-secondary">
        Check each row against its quote before saving &mdash; that&apos;s the only check here.
      </p>
      {rows.length === 0 && (
        <p className="text-sm text-text-secondary">No graded assessments found.</p>
      )}
      {rows.map((row, i) => (
        <div key={i} className="rounded-input border border-border p-3">
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={row.title}
              onChange={(e) => updateRow(i, { title: e.target.value })}
              aria-label="Title"
              className="min-w-[10rem] flex-1 rounded-input border border-border bg-surface px-2 py-1 text-sm text-foreground"
            />
            <select
              value={row.kind}
              onChange={(e) => updateRow(i, { kind: e.target.value as AssessmentKind })}
              aria-label="Kind"
              className="rounded-input border border-border bg-surface px-2 py-1 text-sm text-foreground"
            >
              {ASSESSMENT_KINDS.map((k) => (
                <option key={k} value={k}>{k}</option>
              ))}
            </select>
            <input
              type="date"
              value={row.date ?? ''}
              onChange={(e) => updateRow(i, { date: e.target.value || null })}
              aria-label="Date"
              className="rounded-input border border-border bg-surface px-2 py-1 text-sm text-foreground"
            />
            <input
              type="time"
              value={row.startTime ?? ''}
              onChange={(e) => updateRow(i, { startTime: e.target.value || null })}
              aria-label="Start time"
              className="rounded-input border border-border bg-surface px-2 py-1 text-sm text-foreground"
            />
            <input
              type="number"
              value={row.weight ?? ''}
              onChange={(e) => updateRow(i, {
                weight: e.target.value === '' ? null : Number(e.target.value),
              })}
              placeholder="%"
              aria-label="Weight"
              className="w-16 rounded-input border border-border bg-surface px-2 py-1 text-sm text-foreground"
            />
            <button
              type="button"
              onClick={() => removeRow(i)}
              className="text-sm font-medium text-danger hover:underline"
            >
              Remove
            </button>
          </div>
          <p className="mt-2 text-sm italic text-text-secondary">
            &ldquo;{row.quote}&rdquo; &mdash; page {row.page}
          </p>
          {row.edited && <p className="mt-1 text-sm text-brand-accent">Edited</p>}
        </div>
      ))}
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <div className="flex gap-3">
        <button
          type="button"
          disabled={status === 'saving'}
          onClick={save}
          className="rounded-pill bg-brand px-4 py-1.5 text-sm font-medium text-brand-foreground transition duration-150 ease-out hover:scale-[1.02] hover:bg-brand-hover active:scale-100 disabled:opacity-50 disabled:hover:scale-100"
        >
          {status === 'saving' ? 'Saving…' : 'Save'}
        </button>
        <button
          type="button"
          onClick={() => { setStatus('idle'); setRows([]); setOriginal([]); }}
          className="rounded-pill bg-surface-muted px-4 py-1.5 text-sm font-medium text-foreground"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
