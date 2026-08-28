'use client';

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import WorkdayImportOverlay from '@/components/schedule/WorkdayImportOverlay';
import { writePendingTerms } from '@/schedule/pending-import';
import { useAuthOverlay } from '@/components/AuthOverlayContext';

type Term = { id: string; name: string };

export default function CreateScheduleModal({
  terms,
  loggedIn,
}: {
  terms: Term[];
  /** Signed-out visitors can browse /schedule, but starting either flow
   *  below requires an account — so both buttons prompt sign-in first. */
  loggedIn: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [name, setName] = useState('');
  const [termId, setTermId] = useState(terms[0]?.id ?? '');
  const router = useRouter();
  const { open: openAuth } = useAuthOverlay();

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => (loggedIn ? setOpen(true) : openAuth('login', () => setOpen(true)))}
          className="rounded-pill bg-brand px-5 py-2.5 text-sm font-medium text-brand-foreground transition duration-150 ease-out hover:scale-[1.02] hover:bg-brand-hover active:scale-100"
        >
          Build Schedule
        </button>
        {/* Opens here rather than linking to /schedule/new?import=1: that sent
            the student to an empty builder before the file was even chosen, and
            left them stranded there if the import failed or was cancelled. */}
        <button
          type="button"
          onClick={() =>
            loggedIn ? setImporting(true) : openAuth('login', () => setImporting(true))
          }
          className="rounded-pill border border-border px-5 py-2.5 text-sm font-medium text-foreground transition duration-150 ease-out hover:scale-[1.02] hover:bg-surface-muted active:scale-100"
        >
          Import from Workday
        </button>
      </div>

      <WorkdayImportOverlay
        open={importing}
        onClose={() => setImporting(false)}
        plannableTermIds={terms.map((t) => t.id)}
        onImport={(term, otherTerms) => {
          // Only now is there something to build: park the terms and let the
          // builder adopt the first one via ?fromImport=1.
          writePendingTerms([term, ...otherTerms]);
          router.push('/schedule/new?fromImport=1');
        }}
      />

      {/* Portalled to <body>: this component renders inside .sky-hero (see
          /schedule/page.tsx), which overrides --foreground to white for its
          own title text. A `fixed` dialog is still a DOM descendant even
          though it's visually independent, so without the portal it inherited
          that white text onto its own light card — invisible in light mode. */}
      {open &&
        createPortal(
          <div
            className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 px-6 backdrop-blur-sm"
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) setOpen(false);
            }}
          >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              router.push(
                `/schedule/new?name=${encodeURIComponent(name)}&termId=${encodeURIComponent(termId)}`,
              );
            }}
            className="w-full max-w-sm rounded-card border border-border-hairline bg-surface p-6 shadow-lg"
          >
            <h2 className="text-lg font-semibold text-foreground">Create Saved Schedule</h2>

            <label htmlFor="scheduleName" className="mt-4 block text-xs text-text-tertiary">
              Name
            </label>
            <input
              id="scheduleName"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={80}
              placeholder="e.g. Term 1 draft"
              className="mt-1 w-full rounded-input border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-text-tertiary focus:border-foreground focus:outline-none"
            />

            <label htmlFor="scheduleTerm" className="mt-4 block text-xs text-text-tertiary">
              Term
            </label>
            <select
              id="scheduleTerm"
              value={termId}
              onChange={(e) => setTermId(e.target.value)}
              required
              className="mt-1 w-full rounded-input border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-foreground focus:outline-none"
            >
              {terms.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>

            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-pill border border-border px-5 py-2 text-sm font-medium text-foreground transition-colors hover:bg-surface-muted"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!termId}
                className="rounded-pill bg-brand px-5 py-2 text-sm font-medium text-brand-foreground transition-colors hover:bg-brand-hover disabled:opacity-50"
              >
                Create
              </button>
            </div>
          </form>
          </div>,
          document.body,
        )}
    </>
  );
}
