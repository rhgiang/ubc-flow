'use client';

import { useState } from 'react';
import ConfirmDialog from '@/components/ConfirmDialog';
import {
  ASSESSMENT_KINDS,
  MAX_ASSESSMENT_ROWS,
  type AssessmentKind,
  type ExtractedAssessment,
  type SavedAssessment,
  type SavedAssessmentRow,
} from '@/syllabus/schema';

/** The fields the table can change. `quote` and `page` are not among them:
 *  evidence is whatever the syllabus said, or nothing at all. */
type EditableFields = Partial<Omit<ExtractedAssessment, 'quote' | 'page'>>;

type Row = SavedAssessment & {
  /** Typed by the student, so it has no quote and never will. */
  manual: boolean;
  /** Already flagged editedByUser when this row was loaded. Editing a row and
   *  putting it back cannot un-edit a correction saved days ago. */
  wasEdited: boolean;
  edited: boolean;
};

function rowChanged(a: SavedAssessment, b: SavedAssessment): boolean {
  return a.title !== b.title || a.kind !== b.kind || a.date !== b.date
    || a.startTime !== b.startTime || a.weight !== b.weight;
}

function toRow(a: SavedAssessmentRow): Row {
  return { ...a, manual: a.quote === null, wasEdited: a.editedByUser, edited: a.editedByUser };
}

/**
 * The confirm screen from the design doc's §8 "human in the loop" - extracted
 * rows are proposals only. Every extracted row keeps its verbatim `quote` and
 * `page` visible beside it: that quote is the only way to check the model
 * against the actual PDF, so it is never hidden behind a toggle or dropped.
 * Nothing is written until Save.
 *
 * The same table is also the editor for rows already saved ("Edit dates"),
 * which is why it takes `saved`: correcting a date the model got wrong, or
 * adding an assessment it missed, must not cost another extraction call. That
 * path never touches /api/syllabus/extract.
 */
export default function AssessmentConfirm({
  syllabusId,
  saved,
  alreadyExtracted,
  readable,
  onSaved,
}: {
  syllabusId: string;
  /** Rows already saved for this syllabus, newest save wins. */
  saved: SavedAssessmentRow[];
  alreadyExtracted: boolean;
  /** False for a link-only syllabus: a bookmark is never fetched, so there is
   *  nothing to read. Said outright instead of offering a button that can
   *  only fail, or an empty list that looks like a syllabus with no exams. */
  readable: boolean;
  onSaved: () => void;
}) {
  const [status, setStatus] = useState<'idle' | 'loading' | 'review' | 'saving'>('idle');
  const [mode, setMode] = useState<'extract' | 'edit'>('extract');
  const [error, setError] = useState<string | null>(null);
  const [original, setOriginal] = useState<SavedAssessment[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [confirmReExtract, setConfirmReExtract] = useState(false);

  const editedCount = saved.filter((a) => a.editedByUser).length;

  async function runExtraction() {
    setConfirmReExtract(false);
    setStatus('loading');
    setMode('extract');
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
      const extracted: SavedAssessment[] = data.assessments ?? [];
      setOriginal(extracted);
      setRows(extracted.map((a) => ({ ...a, manual: false, wasEdited: false, edited: false })));
      setStatus('review');
    } catch {
      setError('Could not read this syllabus. Check your connection and try again.');
      setStatus('idle');
    }
  }

  function startEditing() {
    setMode('edit');
    setError(null);
    setOriginal(saved);
    setRows(saved.map(toRow));
    setStatus('review');
  }

  function updateRow(i: number, patch: EditableFields) {
    setRows((prev) => prev.map((row, idx) => {
      if (idx !== i) return row;
      const next: Row = { ...row, ...patch };
      const before = original[i];
      return { ...next, edited: row.wasEdited || !before || rowChanged(next, before) };
    }));
  }

  function addRow() {
    setRows((prev) => [...prev, {
      title: 'Midterm',
      kind: 'midterm',
      date: null,
      startTime: null,
      weight: null,
      quote: null,
      page: null,
      manual: true,
      wasEdited: true,
      edited: true,
    }]);
  }

  function removeRow(i: number) {
    setRows((prev) => prev.filter((_, idx) => idx !== i));
    setOriginal((prev) => prev.filter((_, idx) => idx !== i));
  }

  function close() {
    setStatus('idle');
    setRows([]);
    setOriginal([]);
    setError(null);
  }

  async function save() {
    // A blank title fails validation server-side and the row would vanish
    // without a word, which is the exact surprise this whole screen exists to
    // avoid. Caught here instead, while it can still be typed in.
    if (rows.some((r) => r.title.trim() === '')) {
      setError('Give every assessment a title before saving.');
      return;
    }
    // The route rejects this too; said here so the reason is on screen before
    // a request that can only fail.
    if (rows.length > MAX_ASSESSMENT_ROWS) {
      setError(`That is more than ${MAX_ASSESSMENT_ROWS} assessments, which is the most one syllabus can hold. Remove some before saving.`);
      return;
    }
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
      close();
      onSaved();
    } catch {
      setError('Could not save. Check your connection and try again.');
      setStatus('review');
    }
  }

  if (!readable && saved.length === 0) {
    return (
      <p className="mt-3 text-sm text-text-secondary">
        We can&apos;t read a link, it&apos;s only a bookmark. Open it, select the whole page,
        and paste the text in below to get the midterm dates.
      </p>
    );
  }

  if (status === 'idle') {
    return (
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {saved.length > 0 && (
          <button
            type="button"
            onClick={startEditing}
            className="rounded-pill bg-surface-muted px-4 py-1.5 text-sm font-medium text-foreground transition duration-150 ease-out hover:scale-[1.02] active:scale-100"
          >
            Edit {saved.length} saved {saved.length === 1 ? 'assessment' : 'assessments'}
          </button>
        )}
        {readable && (
          <button
            type="button"
            onClick={() => (editedCount > 0 ? setConfirmReExtract(true) : runExtraction())}
            className="rounded-pill bg-surface-muted px-4 py-1.5 text-sm font-medium text-foreground transition duration-150 ease-out hover:scale-[1.02] active:scale-100"
          >
            {alreadyExtracted ? 'Re-read assessments' : 'Read assessments from this syllabus'}
          </button>
        )}
        {error && <p role="alert" className="w-full text-sm text-danger">{error}</p>}
        <ConfirmDialog
          open={confirmReExtract}
          title="This replaces your corrections"
          confirmLabel="Read it again"
          destructive
          onConfirm={runExtraction}
          onCancel={() => setConfirmReExtract(false)}
        >
          You&apos;ve corrected {editedCount} {editedCount === 1 ? 'row' : 'rows'} on this
          syllabus. Reading it again starts from what the model finds, and saving that
          list replaces your corrections. To fix a date without re-reading, use
          &ldquo;Edit {saved.length} saved {saved.length === 1 ? 'assessment' : 'assessments'}&rdquo;
          instead.
        </ConfirmDialog>
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
        {mode === 'extract'
          ? 'Check each row against its quote before saving, that’s the only check here.'
          : 'Fix a date, add an assessment we missed, or remove one that was cancelled. No re-reading needed.'}
      </p>
      {rows.length === 0 && (
        <p className="text-sm text-text-secondary">
          {mode === 'extract' ? 'No graded assessments found.' : 'Nothing here yet.'}
        </p>
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
          {row.quote !== null ? (
            <p className="mt-2 text-sm italic text-text-secondary">
              &ldquo;{row.quote}&rdquo; (page {row.page})
            </p>
          ) : (
            <p className="mt-2 text-sm text-text-secondary">
              You added this one, so there&apos;s no syllabus quote to check it against.
            </p>
          )}
          {row.edited && <p className="mt-1 text-sm text-brand-accent">Edited</p>}
        </div>
      ))}
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <div className="flex flex-wrap gap-3">
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
          onClick={addRow}
          className="rounded-pill bg-surface-muted px-4 py-1.5 text-sm font-medium text-foreground transition duration-150 ease-out hover:scale-[1.02] active:scale-100"
        >
          Add an assessment
        </button>
        <button
          type="button"
          onClick={close}
          className="rounded-pill bg-surface-muted px-4 py-1.5 text-sm font-medium text-foreground"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
