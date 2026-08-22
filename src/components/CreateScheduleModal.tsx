'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

type Term = { id: string; name: string };

export default function CreateScheduleModal({ terms }: { terms: Term[] }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [termId, setTermId] = useState(terms[0]?.id ?? '');
  const router = useRouter();

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-pill bg-brand px-5 py-2.5 text-sm font-medium text-brand-foreground transition duration-150 ease-out hover:scale-[1.02] hover:bg-brand-hover active:scale-100"
      >
        Create Saved Schedule
      </button>

      {open && (
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
        </div>
      )}
    </>
  );
}
