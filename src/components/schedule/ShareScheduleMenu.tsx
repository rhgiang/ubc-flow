'use client';

import { useEffect, useRef, useState } from 'react';
import { disableScheduleSharing, enableScheduleSharing } from '@/app/actions/schedule';

/**
 * Turn a saved schedule into a link anyone can open.
 *
 * Separate from the subscribe menu because the two do different things: that
 * one puts the schedule INSIDE someone's calendar app and keeps updating it,
 * this one is a page you send someone so they can look. They also revoke
 * independently — turning sharing off here leaves a subscribed feed working.
 */
export default function ShareScheduleMenu({
  scheduleId,
  initialToken,
}: {
  scheduleId: string;
  /** The existing share token, or null when the schedule isn't shared. */
  initialToken: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState<string | null>(initialToken);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [open]);

  const url = token ? `${typeof window === 'undefined' ? '' : window.location.origin}/shared/${token}` : null;

  async function turnOn() {
    setBusy(true);
    setError(null);
    try {
      const r = await enableScheduleSharing(scheduleId);
      if (!r.ok) setError(r.error);
      else setToken(r.token);
    } catch {
      setError('Could not create the link just now. Try again in a moment.');
    } finally {
      setBusy(false);
    }
  }

  async function turnOff() {
    // Destructive and not undoable — the old URL cannot be brought back, so
    // anyone holding it loses access for good. Worth one question.
    if (!window.confirm('Stop sharing? The existing link will stop working and cannot be restored.')) return;
    setBusy(true);
    setError(null);
    try {
      const r = await disableScheduleSharing(scheduleId);
      if (!r.ok) setError(r.error);
      else setToken(null);
    } catch {
      setError('Could not stop sharing just now. Try again in a moment.');
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setError('Could not copy — select the link and copy it manually.');
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="rounded-pill border border-border px-4 py-1.5 text-sm font-medium text-foreground transition duration-150 ease-out hover:scale-[1.02] hover:bg-surface-muted active:scale-100"
      >
        Share
      </button>

      {open && (
        <div className="absolute right-0 top-full z-30 mt-2 w-72 rounded-card border border-border bg-surface p-3 shadow-lg">
          {token === null ? (
            <>
              <p className="text-xs text-text-secondary">
                Creates a link that shows this schedule to anyone who opens it, without signing in.
                It doesn&rsquo;t show your name or email.
              </p>
              <button
                type="button"
                onClick={turnOn}
                disabled={busy}
                className="mt-3 w-full rounded-pill bg-brand px-4 py-2 text-xs font-medium text-brand-foreground disabled:opacity-50"
              >
                {busy ? 'Creating…' : 'Create share link'}
              </button>
            </>
          ) : (
            <>
              <p className="text-xs text-text-secondary">Anyone with this link can see this schedule.</p>
              <input
                readOnly
                value={url ?? ''}
                onFocus={(e) => e.currentTarget.select()}
                className="mt-2 w-full rounded-input border border-border bg-background px-2 py-1.5 text-xs text-foreground"
              />
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={copy}
                  className="flex-1 rounded-pill bg-brand px-3 py-1.5 text-xs font-medium text-brand-foreground"
                >
                  {copied ? 'Copied' : 'Copy link'}
                </button>
                <button
                  type="button"
                  onClick={turnOff}
                  disabled={busy}
                  className="rounded-pill border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:border-danger-border hover:bg-danger-surface hover:text-danger disabled:opacity-50"
                >
                  {busy ? '…' : 'Stop'}
                </button>
              </div>
            </>
          )}
          {error && (
            <p role="alert" className="mt-2 text-xs text-danger">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
