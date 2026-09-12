'use client';

import { useRef, useState } from 'react';

export default function SyllabusUpload({
  courseId,
  termId,
  onUploaded,
}: {
  courseId: string;
  termId: string;
  onUploaded: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const file = form.get('file');
    if (!(file instanceof File) || file.size === 0) {
      setError('Choose a PDF first.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/syllabus', { method: 'POST', body: form });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(data?.error ?? 'Upload failed. Try again in a moment.');
        return;
      }
      formRef.current?.reset();
      onUploaded();
    } catch {
      setError('Could not upload that file. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form ref={formRef} onSubmit={onSubmit} className="mt-3 flex flex-wrap items-center gap-3">
      <input type="hidden" name="courseId" value={courseId} />
      <input type="hidden" name="termId" value={termId} />
      <input
        type="file"
        name="file"
        accept="application/pdf"
        className="max-w-full flex-1 text-sm text-text-secondary file:mr-3 file:rounded-pill file:border-0 file:bg-surface-muted file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-foreground"
      />
      <button
        disabled={busy}
        className="rounded-pill bg-brand px-4 py-1.5 text-sm font-medium text-brand-foreground transition duration-150 ease-out hover:scale-[1.02] hover:bg-brand-hover active:scale-100 disabled:opacity-50 disabled:hover:scale-100"
      >
        {busy ? 'Uploading…' : 'Upload'}
      </button>
      {error && <p role="alert" className="w-full text-sm text-danger">{error}</p>}
    </form>
  );
}
