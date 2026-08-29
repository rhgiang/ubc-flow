'use client';

import { useState } from 'react';
import Link from 'next/link';
import { resetPassword } from '@/app/actions/password-reset';

/**
 * The second half of a password reset. The token arrives in the URL, so this is
 * mounted by /reset rather than being another mode on AuthPanel.
 *
 * The token is not checked until submit. Validating it on load would burn it —
 * consuming is what proves it was unused — and would also turn every crawler
 * or link-preview fetch of the emailed URL into a spent reset.
 */
export default function ResetPasswordForm({ token }: { token: string | null }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const inputClass =
    'w-full rounded-input border border-border bg-background/60 px-4 py-2.5 text-sm text-foreground placeholder:text-text-tertiary focus:border-foreground focus:outline-none';

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    const form = new FormData(e.currentTarget);
    const password = String(form.get('password'));
    if (password !== String(form.get('confirm'))) {
      setError('Those passwords do not match.');
      return;
    }

    setBusy(true);
    const result = await resetPassword(token ?? '', password);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setDone(true);
  }

  return (
    <div className="w-full max-w-sm rounded-card border border-border-hairline bg-surface/70 p-6 shadow-lg backdrop-blur-xl">
      <p className="text-lg font-semibold text-foreground">
        {done ? 'Password updated' : 'Set a new password'}
      </p>

      {done ? (
        <>
          <p className="mt-2 text-sm text-text-secondary">
            You can now log in with your new password.
          </p>
          <Link
            href="/login"
            className="mt-4 inline-block font-medium text-brand-accent hover:underline"
          >
            Go to log in →
          </Link>
        </>
      ) : (
        <form onSubmit={onSubmit} className="mt-4 space-y-3">
          <input
            name="password"
            type="password"
            required
            minLength={10}
            placeholder="New password (10+ characters)"
            autoComplete="new-password"
            className={inputClass}
          />
          <input
            name="confirm"
            type="password"
            required
            minLength={10}
            placeholder="Confirm new password"
            autoComplete="new-password"
            className={inputClass}
          />
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button
            disabled={busy}
            className="w-full rounded-pill bg-brand px-5 py-2.5 text-sm font-medium text-brand-foreground transition duration-150 ease-out hover:scale-[1.02] hover:bg-brand-hover active:scale-100 disabled:opacity-50"
          >
            {busy ? 'Saving…' : 'Set new password'}
          </button>
        </form>
      )}
    </div>
  );
}
