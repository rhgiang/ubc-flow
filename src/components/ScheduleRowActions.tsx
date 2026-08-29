'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { renameSchedule, deleteSchedule, getSubscribeUrl } from '@/app/actions/schedule';

export default function ScheduleRowActions({ scheduleId, name }: { scheduleId: string; name: string }) {
  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [newName, setNewName] = useState(name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [subscribeUrl, setSubscribeUrl] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [open]);

  async function toggleOpen() {
    const next = !open;
    setOpen(next);
    // Fetched lazily (not on every page load) since it's a DB write the
    // first time — creating the CalendarToken row — and most rows never
    // have their menu opened.
    if (next && subscribeUrl === null) {
      try {
        const result = await getSubscribeUrl(scheduleId);
        if (result.ok) setSubscribeUrl(`${window.location.origin}/api/calendar/${result.token}`);
        else setError(result.error);
      } catch {
        // Failing quietly here left the menu open with the subscribe row
        // simply absent, which reads as "this schedule can't be subscribed
        // to" rather than "that didn't load".
        setError('Could not load the subscribe link. Close and reopen this menu.');
      }
    }
  }

  async function submitRename(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await renameSchedule(scheduleId, newName);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setRenaming(false);
      setOpen(false);
      router.refresh();
    } catch {
      setError('Could not rename it just now. Try again in a moment.');
    } finally {
      setBusy(false);
    }
  }

  async function onDelete() {
    if (!window.confirm(`Delete "${name}"? This cannot be undone.`)) return;
    setBusy(true);
    setError(null);
    try {
      const result = await deleteSchedule(scheduleId);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setOpen(false);
      router.refresh();
    } catch {
      setError('Could not delete it just now. Try again in a moment.');
    } finally {
      setBusy(false);
    }
  }

  const webcalUrl = subscribeUrl?.replace(/^https?:\/\//, 'webcal://') ?? null;
  const googleUrl = webcalUrl
    ? `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcalUrl)}`
    : null;

  return (
    <div ref={containerRef} className="relative inline-block">
      <button
        type="button"
        onClick={toggleOpen}
        aria-label="Schedule actions"
        className="rounded-full px-2 py-1 text-text-secondary transition-colors hover:bg-surface-muted hover:text-foreground"
      >
        •••
      </button>

      {open && !renaming && (
        <div className="absolute right-0 top-full z-10 mt-1 w-56 overflow-hidden rounded-card border border-border bg-surface shadow-lg">
          <button
            type="button"
            onClick={() => setRenaming(true)}
            className="block w-full px-4 py-2 text-left text-sm text-foreground hover:bg-surface-muted"
          >
            Rename
          </button>
          <a
            href={webcalUrl ?? undefined}
            aria-disabled={!webcalUrl}
            className={`block px-4 py-2 text-sm hover:bg-surface-muted ${
              webcalUrl ? 'text-foreground' : 'pointer-events-none text-text-tertiary'
            }`}
          >
            Add to Apple / Outlook
          </a>
          <a
            href={googleUrl ?? undefined}
            target="_blank"
            rel="noopener noreferrer"
            aria-disabled={!googleUrl}
            className={`block px-4 py-2 text-sm hover:bg-surface-muted ${
              googleUrl ? 'text-foreground' : 'pointer-events-none text-text-tertiary'
            }`}
          >
            Add to Google Calendar
          </a>
          <button
            type="button"
            onClick={onDelete}
            disabled={busy}
            className="block w-full border-t border-border px-4 py-2 text-left text-sm text-foreground hover:bg-danger-surface hover:text-danger disabled:opacity-50"
          >
            Delete Schedule
          </button>
          {error && <p className="px-4 pb-2 text-xs text-danger">{error}</p>}
        </div>
      )}

      {open && renaming && (
        <form
          onSubmit={submitRename}
          className="absolute right-0 top-full z-10 mt-1 w-56 rounded-card border border-border bg-surface p-3 shadow-lg"
        >
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            required
            maxLength={80}
            autoFocus
            className="w-full rounded-input border border-border bg-background px-2 py-1.5 text-sm text-foreground focus:border-foreground focus:outline-none"
          />
          {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
          <div className="mt-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setRenaming(false)}
              className="rounded-pill px-3 py-1 text-xs text-text-secondary transition duration-150 ease-out hover:scale-[1.02] hover:bg-surface-muted active:scale-100"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy}
              className="rounded-pill bg-brand px-3 py-1 text-xs font-medium text-brand-foreground transition duration-150 ease-out hover:scale-[1.02] hover:bg-brand-hover active:scale-100 disabled:opacity-50 disabled:hover:scale-100"
            >
              {busy ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
