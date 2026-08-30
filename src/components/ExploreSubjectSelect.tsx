'use client';

import { useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

type Subject = { code: string | null; name: string };

export default function ExploreSubjectSelect({
  subjects,
  value,
  multi = false,
}: {
  subjects: Subject[];
  /** In multi mode: a comma-separated list of subject codes. */
  value: string;
  /** Picking a subject toggles it in the list instead of replacing it. */
  multi?: boolean;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const selected = value.split(',').filter(Boolean);
  const current = subjects.find((s) => s.code === value);
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return subjects;
    return subjects.filter((s) => s.code?.toLowerCase().includes(q) || s.name.toLowerCase().includes(q));
  }, [subjects, filter]);

  function navigate(code: string | null) {
    const next = new URLSearchParams(params.toString());
    if (code && multi) {
      // Toggle within the list; the page renders removable chips for it too.
      const list = selected.includes(code) ? selected.filter((c) => c !== code) : [...selected, code];
      if (list.length) next.set('subject', list.join(','));
      else next.delete('subject');
    } else if (code) {
      next.set('subject', code);
    } else {
      next.delete('subject');
    }
    next.delete('page');
    router.push(`/explore?${next.toString()}`);
    setFilter('');
    setOpen(false);
  }

  return (
    <div
      ref={containerRef}
      className="relative mt-2"
      onBlur={(e) => {
        if (!containerRef.current?.contains(e.relatedTarget as Node)) setOpen(false);
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between rounded-input border border-border bg-background px-3 py-2 text-left text-sm text-foreground focus:border-foreground focus:outline-none"
      >
        <span className={current || (multi && selected.length) ? '' : 'text-text-tertiary'}>
          {multi
            ? selected.length === 0
              ? 'All subjects'
              : selected.length === 1
                ? selected[0]
                : `${selected.length} subjects`
            : current
              ? `${current.code} · ${current.name}`
              : 'All subjects'}
        </span>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-3.5 w-3.5 shrink-0 text-text-tertiary">
          <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div className="absolute inset-x-0 top-full z-10 mt-1 overflow-hidden rounded-card border border-border bg-surface shadow-lg">
          <input
            autoFocus
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            onKeyDown={(e) => {
              // Enter picks the top match — typing "cpsc⏎" must just work.
              if (e.key === 'Enter' && filtered.length > 0 && filtered[0].code) {
                e.preventDefault();
                navigate(filtered[0].code);
              }
            }}
            placeholder="Search subjects"
            className="w-full border-b border-border bg-transparent px-3 py-2 text-sm text-foreground placeholder:text-text-tertiary focus:outline-none"
          />
          <div
            // Tapping an option must not blur the filter input first: on touch
            // (and Safari) buttons never receive focus, so blur would see
            // relatedTarget=null and unmount the option before its click
            // fires. Same guard as SearchBar; on the list only, so taps in
            // the filter input above still place the caret.
            onMouseDown={(e) => e.preventDefault()}
            className="max-h-64 overflow-y-auto"
          >
            <button
              type="button"
              onClick={() => navigate(null)}
              className="block w-full px-3 py-2 text-left text-sm text-text-secondary hover:bg-surface-muted"
            >
              All subjects
            </button>
            {filtered.map((s) => (
              <button
                key={s.code}
                type="button"
                onClick={() => navigate(s.code)}
                className={`block w-full px-3 py-2 text-left text-sm hover:bg-surface-muted ${
                  (multi ? selected.includes(s.code ?? '') : s.code === value)
                    ? 'bg-surface-muted font-medium text-foreground'
                    : 'text-foreground'
                }`}
              >
                {s.code} · {s.name}
              </button>
            ))}
            {filtered.length === 0 && <p className="px-3 py-2 text-sm text-text-tertiary">No subjects found</p>}
          </div>
        </div>
      )}
    </div>
  );
}
