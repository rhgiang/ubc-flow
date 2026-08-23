'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { UBC_WORKDAY_URL } from '@/lib/links';

type ImportResult = {
  matched: number;
  unmatched: string[];
  excluded: number;
  boundStudent: boolean;
};

export default function UploadCoursesForm({ verified }: { verified: boolean }) {
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    // Validated here rather than with `required`: the real input is visually
    // hidden behind the label below, and browsers refuse to show a validation
    // bubble on a control they cannot focus.
    if (!fileName) {
      setError('Choose your Workday export first.');
      return;
    }
    setBusy(true);
    setError(null);

    const res = await fetch('/api/upload', {
      method: 'POST',
      body: new FormData(e.currentTarget),
    });
    const data = await res.json();

    if (!res.ok) {
      setError(data.error ?? 'Upload failed.');
    } else {
      setResult(data);
      // Ready for the next export — these are uploaded one at a time.
      formRef.current?.reset();
      setFileName(null);
    }
    setBusy(false);
  }

  return (
    <section>
      <h2 className="text-xl font-semibold text-foreground">
        {verified ? 'Upload more courses' : "Verify you're a UBC student"}
      </h2>
      <p className="mt-2 text-sm text-text-secondary">
        Upload your Workday export so we know which courses you&apos;ve taken. You can
        only review courses you were actually enrolled in.
      </p>

      <div className="mt-6 rounded-card border border-border bg-surface-muted p-5 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="font-medium text-foreground">Where to find these in Workday</p>
          <a
            href={UBC_WORKDAY_URL}
            target="_blank"
            rel="noreferrer"
            className="text-xs font-medium text-brand-accent hover:underline"
          >
            Open Workday ↗
          </a>
        </div>
        <ul className="mt-3 space-y-2 text-text-secondary">
          <li>
            <span className="font-medium text-foreground">Current courses:</span> Workday → Academics →
            <span className="font-medium text-foreground"> View My Courses</span> → the
            <span className="font-medium text-foreground"> Export to Excel</span> icon above the table
          </li>
          <li>
            <span className="font-medium text-foreground">Past courses:</span> Workday → Academics →
            <span className="font-medium text-foreground"> View My Academic Record</span> →
            <span className="font-medium text-foreground"> Export to Excel</span>
          </li>
        </ul>
        <p className="mt-3 text-text-tertiary">
          Upload them one at a time. Both are <code>.xlsx</code> files.
        </p>
      </div>

      <form ref={formRef} onSubmit={onSubmit} className="mt-6 flex flex-wrap items-center gap-3">
        {/* The native control renders its own button AND a "no file chosen"
            label, which read as two competing controls inside our styled box.
            The input is hidden and this label is the whole control: one line
            that names the file once chosen. */}
        <label className="flex flex-1 cursor-pointer items-center gap-2 rounded-input border border-border bg-background px-4 py-2 text-sm transition duration-150 ease-out hover:scale-[1.02] hover:border-foreground">
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
            onChange={(e) => setFileName(e.target.files?.[0]?.name ?? null)}
            className="sr-only"
          />
        </label>
        <button
          disabled={busy}
          className="rounded-pill bg-brand px-5 py-2 text-sm font-medium text-brand-foreground transition duration-150 ease-out hover:scale-[1.02] hover:bg-brand-hover active:scale-100 disabled:opacity-50"
        >
          {busy ? 'Reading…' : 'Upload'}
        </button>
      </form>

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

      {result && (
        <section className="mt-6 rounded-card border border-border p-5">
          <p className="text-lg font-medium text-foreground">
            Matched {result.matched} course{result.matched === 1 ? '' : 's'}
          </p>
          {result.excluded > 0 && (
            <p className="mt-1 text-sm text-text-secondary">
              Skipped {result.excluded} transfer credit
              {result.excluded === 1 ? '' : 's'} — those were earned at another
              institution, so they don&apos;t unlock UBC reviews.
            </p>
          )}

          {/* Required by spec 4.2: never drop unmatched rows silently. */}
          {result.unmatched.length > 0 && (
            <div className="mt-4">
              <p className="text-sm font-medium text-foreground">
                We couldn&apos;t match {result.unmatched.length}:
              </p>
              <ul className="mt-1 text-sm text-text-secondary">
                {result.unmatched.map((code) => (
                  <li key={code}>{code}</li>
                ))}
              </ul>
              <p className="mt-1 text-xs text-text-tertiary">
                These may be courses we haven&apos;t indexed yet.
              </p>
            </div>
          )}

          {result.matched > 0 && !verified && (
            <Link
              href="/"
              className="mt-5 inline-block rounded-pill bg-brand px-5 py-2 text-sm font-medium text-brand-foreground"
            >
              Done — start browsing →
            </Link>
          )}
        </section>
      )}

      <p className="mt-6 text-xs text-text-tertiary">
        We only read which courses you took. Your grades and student number are never
        stored, and the file itself is never saved.
      </p>
    </section>
  );
}
