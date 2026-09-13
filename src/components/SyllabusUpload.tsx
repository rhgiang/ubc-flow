'use client';

import { useId, useRef, useState } from 'react';

type Mode = 'file' | 'url' | 'text';
/** Nothing picked yet. The dropdown opens on this, so no field shows until a
 *  student chooses one and the form starts as a single control. */
type Choice = Mode | '';

const FIELD =
  'mt-2 block w-full rounded-input border border-border bg-surface px-2 py-1 text-sm text-foreground';

/** What each source is actually good for, said where the student picks it. */
const HINT: Record<Mode, string> = {
  file: 'We read the PDF and fill in your midterms.',
  url: "A link is a bookmark. We can't read it, so it won't fill in midterms.",
  text: 'Open the syllabus, select all, paste. We read it the same as a PDF.',
};

/**
 * Three ways to record a syllabus, because not every UBC syllabus is a file
 * you can download, plenty live on a Canvas page behind login.
 *
 * A dropdown rather than three stacked radios with three inputs under them:
 * only one source is being added at a time, so showing the other two fields
 * is noise. The row can still hold all three over time, one submit each.
 */
export default function SyllabusUpload({
  courseId,
  termId,
  onUploaded,
}: {
  courseId: string;
  termId: string;
  onUploaded: () => void;
}) {
  const selectId = useId();
  const [mode, setMode] = useState<Choice>('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    if (mode === '') {
      setError('Choose how you are adding it first.');
      return;
    }

    // Only the chosen source is sent: the other two inputs are still in the
    // form (they keep whatever the student typed while switching) and an
    // empty one would otherwise reach the route as a rejected field.
    for (const field of ['file', 'url', 'sourceText'] as const) {
      if (field !== fieldFor(mode)) form.delete(field);
    }

    const value = form.get(fieldFor(mode));
    if (value instanceof File ? value.size === 0 : typeof value !== 'string' || value.trim() === '') {
      setError(mode === 'file' ? 'Choose a PDF first.'
        : mode === 'url' ? 'Paste a link first.'
        : 'Paste the syllabus text first.');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/syllabus', { method: 'POST', body: form });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(data?.error ?? 'That did not save. Try again in a moment.');
        return;
      }
      formRef.current?.reset();
      // reset() clears the inputs but not React state, and a saved source
      // should leave the picker back on "Select" rather than on the kind that
      // was just added.
      setMode('');
      onUploaded();
    } catch {
      setError('Could not save that. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form ref={formRef} onSubmit={onSubmit} className="mt-3 space-y-3">
      <input type="hidden" name="courseId" value={courseId} />
      <input type="hidden" name="termId" value={termId} />

      <select
        id={selectId}
        value={mode}
        onChange={(e) => setMode(e.target.value as Choice)}
        aria-label="How to add this syllabus"
        className={`${FIELD} mt-0`}
      >
        <option value="">Select</option>
        <option value="file">Upload a PDF</option>
        <option value="url">Add a link</option>
        <option value="text">Paste the text</option>
      </select>

      {/*
        Only the chosen source is rendered. The submit handler still strips the
        other field names, which now costs nothing and keeps it correct if a
        field is ever shown in more than one mode.
      */}
      {mode === 'file' && (
        <input
          type="file"
          name="file"
          accept="application/pdf"
          aria-label="Syllabus PDF"
          className="block max-w-full text-sm text-text-secondary file:mr-3 file:rounded-pill file:border-0 file:bg-surface-muted file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-foreground"
        />
      )}

      {mode === 'url' && (
        <input
          type="url"
          name="url"
          placeholder="https://canvas.ubc.ca/..."
          aria-label="Syllabus link"
          className={FIELD}
        />
      )}

      {mode === 'text' && (
        <textarea
          name="sourceText"
          rows={5}
          placeholder="Open the syllabus, select all, paste here"
          aria-label="Syllabus text"
          className={FIELD}
        />
      )}

      {mode !== '' && <p className="text-sm text-text-secondary">{HINT[mode]}</p>}

      <div className="flex items-center gap-3">
        <button
          disabled={busy}
          className="rounded-pill bg-brand px-4 py-1.5 text-sm font-medium text-brand-foreground transition duration-150 ease-out hover:scale-[1.02] hover:bg-brand-hover active:scale-100 disabled:opacity-50 disabled:hover:scale-100"
        >
          {busy ? 'Saving…' : 'Save'}
        </button>
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      </div>
    </form>
  );
}

function fieldFor(mode: Mode): 'file' | 'url' | 'sourceText' {
  return mode === 'text' ? 'sourceText' : mode;
}
