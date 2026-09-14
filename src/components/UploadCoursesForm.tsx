"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { UBC_WORKDAY_URL } from "@/lib/links";

type ImportResult = {
  matched: number;
  unmatched: string[];
  excluded: number;
  /** Credits earned elsewhere. Stored and counted, but never an enrolment. */
  transfers: number;
  removed: number;
  /** Courses kept because this file said nothing about their term. */
  untouched: string[];
  /** Diagnostic only, logged server-side. Never shown to a student. */
  unexpectedStatuses: string[];
  boundStudent: boolean;
};

export default function UploadCoursesForm({ verified }: { verified: boolean }) {
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const router = useRouter();

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    // Validated here rather than with `required`: the real input is visually
    // hidden behind the label below, and browsers refuse to show a validation
    // bubble on a control they cannot focus.
    if (!fileName) {
      setError("Choose your Workday export first.");
      return;
    }
    setBusy(true);
    setError(null);

    try {
      const res = await fetch('/api/upload', {
        method: 'POST',
        body: new FormData(e.currentTarget),
      });
      // Parsed INSIDE the ok-check, because a failure is exactly when the body
      // is least likely to be JSON - a proxy timeout or a crashed route hands
      // back HTML, and parsing that first threw before anything could report
      // it, leaving the button on "Uploading…" for good.
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(data?.error ?? 'Upload failed. Try again in a moment.');
        return;
      }
      setResult(await res.json());
      // Ready for the next export - these are uploaded one at a time.
      formRef.current?.reset();
      setFileName(null);
      // The Current/Past course lists above are rendered on the server from
      // Enrollment rows this upload just wrote. Without this they keep showing
      // the pre-upload state until the student reloads by hand - the summary
      // says "Matched 12 courses" while the lists above show none of them.
      router.refresh();
    } catch {
      setError('Could not upload that file. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    // Linked to as /onboarding#upload from the calendar's "Update courses" -
    // scroll-mt keeps the heading clear of the sticky nav on landing.
    <section id="upload" className="scroll-mt-24">
      <h2 className="text-xl font-semibold text-foreground">
        {verified ? "Upload more courses" : "Verify you're a UBC student"}
      </h2>
      <p className="mt-2 text-sm text-text-secondary">
        Upload your Workday export so we know which courses you&apos;ve taken.
        You can only review courses you were actually enrolled in.
      </p>

      <div className="mt-6 rounded-card border border-border bg-surface-muted p-5 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="font-medium text-foreground">
            Where to find these in Workday
          </p>
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
            <span className="font-medium text-foreground">
              Current courses:
            </span>{" "}
            Workday →
            <span className="font-medium text-foreground"> Student</span> →
            <span className="font-medium text-foreground"> Academics</span> →
            <span className="font-medium text-foreground">
              {" "}
              Registration &amp; Courses
            </span>{" "}
            →
            <span className="font-medium text-foreground">
              {" "}
              View My Courses
            </span>{" "}
            → the
            <span className="font-medium text-foreground">
              {" "}
              Export to Excel
            </span>{" "}
            icon above the table
          </li>
          <li>
            <span className="font-medium text-foreground">Past courses:</span>{" "}
            Workday →
            <span className="font-medium text-foreground"> Student</span> →
            <span className="font-medium text-foreground"> Academics</span> →
            <span className="font-medium text-foreground">
              {" "}
              View My Academic Record
            </span>{" "}
            →
            <span className="font-medium text-foreground">
              {" "}
              Export to Excel
            </span>
          </li>
        </ul>
        <p className="mt-3 text-text-tertiary">
          Upload them one at a time. Both are <code>.xlsx</code> files.
        </p>
      </div>

      <form
        ref={formRef}
        onSubmit={onSubmit}
        className="mt-6 flex flex-wrap items-center gap-3"
      >
        {/* The native control renders its own button AND a "no file chosen"
            label, which read as two competing controls inside our styled box.
            The input is hidden and this label is the whole control: one line
            that names the file once chosen. */}
        <label className="flex flex-1 cursor-pointer items-center gap-2 rounded-input border border-border bg-background px-4 py-2 text-sm transition-colors duration-150 ease-out hover:border-foreground hover:bg-surface-muted focus-within:border-foreground focus-within:bg-surface-muted">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.75}
            aria-hidden
            className="h-4 w-4 shrink-0 text-text-tertiary"
          >
            <path
              d="M12 16V4m0 0L8 8m4-4 4 4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"
              strokeLinecap="round"
            />
          </svg>
          <span
            className={`truncate ${fileName ? "text-foreground" : "text-text-tertiary"}`}
          >
            {fileName ?? "Choose your .xlsx export"}
          </span>
          <input
            type="file"
            name="file"
            accept=".xlsx"
            // Cleared on every open, so re-picking the SAME file still fires
            // change. Without this a second upload of one file is silently
            // ignored - the browser treats an identical selection as no change,
            // and the box goes on saying no file is chosen.
            onClick={(e) => {
              e.currentTarget.value = "";
              setFileName(null);
            }}
            onChange={(e) => setFileName(e.target.files?.[0]?.name ?? null)}
            className="sr-only"
          />
        </label>
        <button
          disabled={busy}
          className="rounded-pill bg-brand px-5 py-2 text-sm font-medium text-brand-foreground transition duration-150 ease-out hover:scale-[1.02] hover:bg-brand-hover active:scale-100 disabled:opacity-50 disabled:hover:scale-100"
        >
          {busy ? "Reading…" : "Upload"}
        </button>
      </form>

      {error && <p role="alert" className="mt-4 text-sm text-danger">{error}</p>}

      {result && (
        <section className="mt-6 rounded-card border border-border p-5">
          {/*
            An academic record can be entirely transfer credit, and those are
            deliberately not enrolments - so "Matched 0 courses" was the whole
            message for an upload that had in fact recorded everything in the
            file. The headline now says what happened rather than what did not.
          */}
          <p className="text-lg font-medium text-foreground">
            {result.matched === 0 && result.transfers > 0
              ? `Recorded ${result.transfers} transfer credit${result.transfers === 1 ? "" : "s"}`
              : `Matched ${result.matched} course${result.matched === 1 ? "" : "s"}`}
          </p>
          {result.removed > 0 && (
            <p className="mt-1 text-sm text-text-secondary">
              Removed {result.removed} course{result.removed === 1 ? "" : "s"}{" "}
              you&apos;re no longer registered in for{" "}
              {result.removed === 1 ? "that term" : "those terms"}.
            </p>
          )}
          {/*
            The other half of the removal story. The importer only prunes
            terms the file actually covers, so a course dropped in a term this
            export doesn't mention survives it, and used to do so in total
            silence. Naming them is what makes a manual removal findable.
          */}
          {result.untouched.length > 0 && (
            <div className="mt-4">
              <p className="text-sm font-medium text-foreground">
                Kept {result.untouched.length} course
                {result.untouched.length === 1 ? "" : "s"} this file didn&apos;t mention:
              </p>
              <ul className="mt-1 text-sm text-text-secondary">
                {result.untouched.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
              <p className="mt-1 text-xs text-text-tertiary">
                This export says nothing about{" "}
                {result.untouched.length === 1 ? "that term" : "those terms"}, so we left{" "}
                {result.untouched.length === 1 ? "it" : "them"} alone instead of deleting a
                term the file doesn&apos;t cover. If you&apos;ve dropped one, use Remove on
                its card in Current courses or Past courses above.
              </p>
            </div>
          )}
          {result.transfers > 0 && (
            <p className="mt-1 text-sm text-text-secondary">
              {result.matched > 0 &&
                `Plus ${result.transfers} transfer credit${result.transfers === 1 ? "" : "s"}. `}
              Transfer credit counts toward your degree in{" "}
              <Link href="/guidance" className="underline">
                Guidance
              </Link>
              , but was earned at another institution, so it doesn&apos;t unlock
              UBC reviews.
            </p>
          )}
          {result.excluded > 0 && (
            <p className="mt-1 text-sm text-text-secondary">
              Skipped {result.excluded} row{result.excluded === 1 ? "" : "s"} we
              couldn&apos;t read.
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

          {(result.matched > 0 || result.transfers > 0) && !verified && (
            <Link
              href="/"
              className="mt-5 inline-block rounded-pill bg-brand px-5 py-2 text-sm font-medium text-brand-foreground"
            >
              Done. Start browsing →
            </Link>
          )}
        </section>
      )}

      <p className="mt-6 text-xs text-text-tertiary">
        We only read which courses you took. Your grades and student number are
        never stored, and the file itself is never saved.
      </p>
    </section>
  );
}
