'use client';

import { useEffect, useRef, useState } from 'react';
import ConfirmDialog from '@/components/ConfirmDialog';

type TokenResult = { ok: true; token: string } | { ok: false; error: string };
type PlainResult = { ok: true } | { ok: false; error: string };

/**
 * Turn something into a link anyone can open — a saved schedule or a term's
 * imported calendar; the caller supplies the enable/revoke actions and the
 * public path, so this stays one component for both.
 *
 * Separate from the subscribe menu because the two do different things: that
 * one puts the schedule INSIDE someone's calendar app and keeps updating it,
 * this one is a page you send someone so they can look. They also revoke
 * independently — turning sharing off here leaves a subscribed feed working.
 */
export default function ShareLinkMenu({
  initialToken,
  pathFor,
  enable,
  disable,
  description,
  align = 'right',
}: {
  /** The existing share token, or null when not shared yet. */
  initialToken: string | null;
  /** Public path for a token, e.g. (t) => `/shared/${t}`. */
  pathFor: (token: string) => string;
  enable: () => Promise<TokenResult>;
  disable: () => Promise<PlainResult>;
  /** What the created link shows, in the words of this call site. */
  description: string;
  /** Which edge of the button the popover hangs from. */
  align?: 'left' | 'right';
}) {
  const [open, setOpen] = useState(false);
  const [confirmingStop, setConfirmingStop] = useState(false);
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

  const url = token ? `${typeof window === 'undefined' ? '' : window.location.origin}${pathFor(token)}` : null;

  async function turnOn() {
    setBusy(true);
    setError(null);
    try {
      const r = await enable();
      if (!r.ok) setError(r.error);
      else setToken(r.token);
    } catch {
      setError('Could not create the link just now. Try again in a moment.');
    } finally {
      setBusy(false);
    }
  }

  async function turnOff() {
    setBusy(true);
    setError(null);
    try {
      const r = await disable();
      if (!r.ok) setError(r.error);
      else setToken(null);
    } catch {
      setError('Could not stop sharing just now. Try again in a moment.');
    } finally {
      setBusy(false);
      setConfirmingStop(false);
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
        title="Share this calendar"
        aria-label="Share this calendar"
        className="flex h-9 w-9 items-center justify-center rounded-full border border-border text-foreground transition duration-150 ease-out hover:scale-[1.05] hover:bg-surface-muted active:scale-100"
      >
        {/* Two nodes joined to a third: the share glyph every platform uses. */}
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} aria-hidden className="h-4 w-4">
          <circle cx="18" cy="5" r="3" />
          <circle cx="6" cy="12" r="3" />
          <circle cx="18" cy="19" r="3" />
          <path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4" strokeLinecap="round" />
        </svg>
      </button>

      {open && (
        <div
          className={`absolute top-full z-30 mt-2 w-72 rounded-card border border-border bg-surface p-3 shadow-lg ${
            align === 'right' ? 'right-0' : 'left-0'
          }`}
        >
          {token === null ? (
            <>
              <p className="text-xs text-text-secondary">{description}</p>
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
              <p className="text-xs text-text-secondary">Anyone with this link can see it.</p>
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
                  onClick={() => setConfirmingStop(true)}
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

      {/* Destructive and not undoable — the old URL cannot be brought back,
          so anyone holding it loses access for good. Worth one question,
          asked in the site's own dialog rather than window.confirm's
          browser-stamped one. */}
      <ConfirmDialog
        open={confirmingStop}
        title="Stop sharing?"
        confirmLabel="Stop sharing"
        destructive
        busy={busy}
        onConfirm={() => void turnOff()}
        onCancel={() => setConfirmingStop(false)}
      >
        The existing link will stop working and cannot be restored.
      </ConfirmDialog>
    </div>
  );
}
