'use client';

import { useEffect, useRef, useState } from 'react';
import { signOut } from 'next-auth/react';
import { deleteAccount } from '@/app/actions/account';

const CONFIRM_WORD = 'DELETE';

export default function DeleteAccountButton() {
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  useEffect(() => {
    if (open) dialogRef.current?.focus();
  }, [open]);

  async function onConfirm() {
    setBusy(true);
    setError(null);
    try {
      const result = await deleteAccount();
      if (!result.ok) {
        setError(result.error);
        setBusy(false);
        return;
      }
      // The account is already gone server-side; this just clears the local
      // session so the browser stops believing it's still signed in.
      await signOut({ redirectTo: '/' });
    } catch {
      // Deliberately ambiguous about WHETHER it happened, because from here
      // we genuinely cannot tell: the delete may have succeeded and only the
      // sign-out failed. Telling them to reload is the one instruction that
      // is correct either way.
      setError('We could not confirm whether your account was deleted. Reload the page to check.');
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-pill border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:border-danger-border hover:bg-danger-surface hover:text-danger"
      >
        Delete account
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Delete account"
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 px-6 backdrop-blur-sm"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !busy) setOpen(false);
          }}
        >
          <div
            ref={dialogRef}
            tabIndex={-1}
            className="w-full max-w-md rounded-card border border-border-hairline bg-surface p-6 shadow-lg"
          >
            <h2 className="text-base font-semibold text-foreground">Delete your account</h2>
            <p className="mt-2 text-sm text-text-secondary">
              This permanently deletes your account: your reviews, your saved schedules, your
              enrollment records, and your verification status. It can&apos;t be undone.
            </p>

            <label htmlFor="confirmDelete" className="mt-4 block text-xs text-text-tertiary">
              Type {CONFIRM_WORD} to confirm
            </label>
            <input
              id="confirmDelete"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              disabled={busy}
              autoComplete="off"
              className="mt-1 w-full rounded-input border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-foreground focus:outline-none"
            />

            {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={busy}
                className="rounded-pill border border-border px-4 py-2 text-sm font-medium text-foreground transition duration-150 ease-out hover:scale-[1.02] hover:bg-surface-muted active:scale-100 disabled:opacity-50 disabled:hover:scale-100"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={onConfirm}
                disabled={busy || confirmText !== CONFIRM_WORD}
                className="rounded-pill bg-danger px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-danger/90 disabled:opacity-50"
              >
                {busy ? 'Deleting…' : 'Delete permanently'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
