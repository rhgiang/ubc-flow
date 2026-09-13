'use client';

import { useRef, useState } from 'react';

type Mode = 'file' | 'url' | 'text';

const RADIO = 'h-4 w-4 accent-brand';
const LABEL = 'flex w-fit cursor-pointer items-center gap-2 text-sm text-foreground';

/**
 * Three ways to record a syllabus, because not every UBC syllabus is a file
 * you can download - plenty live on a Canvas page behind login. The radio
 * picks which one this submit carries; the row can hold all three over time.
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
  const [mode, setMode] = useState<Mode>('file');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);

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

      <div>
        <label className={LABEL}>
          <input
            type="radio"
            name="mode"
            checked={mode === 'file'}
            onChange={() => setMode('file')}
            className={RADIO}
          />
          <span className="font-medium">Upload a PDF</span>
        </label>
        <input
          type="file"
          name="file"
          accept="application/pdf"
          aria-label="Syllabus PDF"
          onFocus={() => setMode('file')}
          className="mt-1 ml-6 block max-w-full text-sm text-text-secondary file:mr-3 file:rounded-pill file:border-0 file:bg-surface-muted file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-foreground"
        />
      </div>

      <div>
        <label className={LABEL}>
          <input
            type="radio"
            name="mode"
            checked={mode === 'url'}
            onChange={() => setMode('url')}
            className={RADIO}
          />
          <span className="font-medium">Add a link</span>
        </label>
        <input
          type="url"
          name="url"
          placeholder="https://canvas.ubc.ca/..."
          aria-label="Syllabus link"
          onFocus={() => setMode('url')}
          className="mt-1 ml-6 block w-[calc(100%-1.5rem)] rounded-input border border-border bg-surface px-2 py-1 text-sm text-foreground"
        />
      </div>

      <div>
        <label className={LABEL}>
          <input
            type="radio"
            name="mode"
            checked={mode === 'text'}
            onChange={() => setMode('text')}
            className={RADIO}
          />
          <span className="font-medium">Paste the text</span>
        </label>
        <textarea
          name="sourceText"
          rows={4}
          placeholder="Open the syllabus, select all, paste here"
          aria-label="Syllabus text"
          onFocus={() => setMode('text')}
          className="mt-1 ml-6 block w-[calc(100%-1.5rem)] rounded-input border border-border bg-surface px-2 py-1 text-sm text-foreground"
        />
      </div>

      <p className="text-sm text-text-secondary">
        A link on its own is just a bookmark, we can&apos;t read it. A PDF or the pasted
        text is what fills in your midterms.
      </p>

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
