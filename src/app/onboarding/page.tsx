'use client';

import { useState } from 'react';
import Link from 'next/link';
import { signOut } from 'next-auth/react';

type ImportResult = {
  matched: number;
  unmatched: string[];
  excluded: number;
  boundStudent: boolean;
};

export default function OnboardingPage() {
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);

    const res = await fetch('/api/upload', {
      method: 'POST',
      body: new FormData(e.currentTarget),
    });
    const data = await res.json();

    if (!res.ok) setError(data.error ?? 'Upload failed.');
    else setResult(data);
    setBusy(false);
  }

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <h1 className="text-3xl font-semibold">Verify you&apos;re a UBC student</h1>
      <p className="mt-2 text-slate-600">
        Upload your Workday export so we know which courses you&apos;ve taken. You can
        only review courses you were actually enrolled in.
      </p>

      <div className="mt-8 rounded-lg border bg-slate-50 p-5 text-sm">
        <p className="font-medium">Where to find these in Workday</p>
        <ul className="mt-3 space-y-2 text-slate-700">
          <li>
            <span className="font-medium">Current courses:</span> Workday → Academics →
            <span className="font-medium"> View My Courses</span> → the
            <span className="font-medium"> Export to Excel</span> icon above the table
          </li>
          <li>
            <span className="font-medium">Past courses:</span> Workday → Academics →
            <span className="font-medium"> View My Academic Record</span> →
            <span className="font-medium"> Export to Excel</span>
          </li>
        </ul>
        <p className="mt-3 text-slate-500">
          Upload them one at a time. Both are <code>.xlsx</code> files.
        </p>
      </div>

      <form onSubmit={onSubmit} className="mt-6 flex flex-wrap items-center gap-3">
        <input
          type="file"
          name="file"
          accept=".xlsx"
          required
          className="flex-1 rounded-lg border px-4 py-2"
        />
        <button
          disabled={busy}
          className="rounded-lg bg-blue-700 px-5 py-2 text-white transition-transform duration-150 ease-out hover:scale-[1.02] active:scale-100 disabled:opacity-50"
        >
          {busy ? 'Reading…' : 'Upload'}
        </button>
      </form>

      {error && <p className="mt-4 text-sm text-red-700">{error}</p>}

      {result && (
        <section className="mt-8 rounded-lg border p-5">
          <p className="text-lg font-medium">
            Matched {result.matched} course{result.matched === 1 ? '' : 's'}
          </p>
          {result.excluded > 0 && (
            <p className="mt-1 text-sm text-slate-600">
              Skipped {result.excluded} transfer credit
              {result.excluded === 1 ? '' : 's'} — those were earned at another
              institution, so they don&apos;t unlock UBC reviews.
            </p>
          )}

          {/* Required by spec 4.2: never drop unmatched rows silently. */}
          {result.unmatched.length > 0 && (
            <div className="mt-4">
              <p className="text-sm font-medium">
                We couldn&apos;t match {result.unmatched.length}:
              </p>
              <ul className="mt-1 text-sm text-slate-600">
                {result.unmatched.map((code) => (
                  <li key={code}>{code}</li>
                ))}
              </ul>
              <p className="mt-1 text-xs text-slate-500">
                These may be courses we haven&apos;t indexed yet.
              </p>
            </div>
          )}

          {result.matched > 0 && (
            <Link
              href="/"
              className="mt-5 inline-block rounded-lg bg-blue-700 px-5 py-2 text-white"
            >
              Done — start browsing →
            </Link>
          )}
        </section>
      )}

      <p className="mt-8 text-xs text-slate-500">
        We only read which courses you took. Your grades and student number are never
        stored, and the file itself is never saved.
      </p>

      <button
        type="button"
        onClick={() => signOut({ redirectTo: '/' })}
        className="mt-8 inline-block text-sm text-slate-500 transition-transform duration-150 ease-out hover:scale-105 hover:text-slate-700 hover:underline active:scale-100"
      >
        Sign out
      </button>
    </main>
  );
}
