'use client';

import { useState } from 'react';
import Link from 'next/link';
import { resetPassword } from '@/app/actions/password-reset';

/**
 * The second half of a password reset. The token arrives in the URL, so this is
 * mounted by /reset rather than being another mode on AuthPanel.
 *
 * The token is not checked until submit. Validating it on load would burn it -
 * consuming is what proves it was unused - and would also turn every crawler
 * or link-preview fetch of the emailed URL into a spent reset.
 */
const MIN = 10;

export default function ResetPasswordForm({ token }: { token: string | null }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);

  const inputClass =
    'w-full rounded-input border border-border bg-background/60 px-4 py-2.5 pr-12 text-sm text-foreground placeholder:text-text-tertiary focus:border-foreground focus:outline-none';

  // Checked as they type rather than only on submit. Being told a password is
  // too short after pressing the button, on a link that works once, is a poor
  // trade for the two lines this costs.
  const tooShort = password.length > 0 && password.length < MIN;
  const mismatch = confirm.length > 0 && password !== confirm;
  const ready = password.length >= MIN && password === confirm && !busy;

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const result = await resetPassword(token ?? '', password);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setDone(true);
    } catch {
      // A reset link works once and expires in an hour, so a stuck button
      // here costs the user the link as well as the attempt.
      setError('Could not set your password just now. Try again in a moment.');
    } finally {
      setBusy(false);
    }
  }

  // No token at all means the link was truncated by a mail client, or somebody
  // typed the path. Say so now rather than after they have chosen a password.
  if (!token) {
    return (
      <Card>
        <h1 className="text-lg font-semibold text-foreground">This link is incomplete</h1>
        <p className="mt-2 text-sm text-text-secondary">
          Reset links are long, and some mail apps cut them short. Open the link from your email
          again, or ask for a new one.
        </p>
        <Link
          href="/login"
          className="mt-4 inline-block text-sm font-medium text-brand-accent hover:underline"
        >
          Send a new reset link
        </Link>
      </Card>
    );
  }

  if (done) {
    return (
      <Card>
        <div className="flex items-center gap-2">
          <span
            aria-hidden
            className="flex h-6 w-6 items-center justify-center rounded-full bg-brand text-sm text-brand-foreground"
          >
            {'✓'}
          </span>
          <h1 className="text-lg font-semibold text-foreground">Password updated</h1>
        </div>
        <p className="mt-2 text-sm text-text-secondary">
          Your new password is active. The link you used has been spent and will not work again.
        </p>
        <Link
          href="/login"
          className="mt-5 inline-flex w-full items-center justify-center rounded-pill bg-brand px-5 py-2.5 text-sm font-medium text-brand-foreground transition duration-150 ease-out hover:scale-[1.02] hover:bg-brand-hover active:scale-100"
        >
          Log in
        </Link>
      </Card>
    );
  }

  return (
    <Card>
      <h1 className="text-lg font-semibold text-foreground">Set a new password</h1>
      <p className="mt-1.5 text-sm text-text-secondary">
        Choose something at least {MIN} characters long. This link works once.
      </p>

      <form onSubmit={onSubmit} className="mt-5 space-y-4">
        <Field
          id="new-password"
          label="New password"
          value={password}
          onChange={setPassword}
          show={show}
          autoComplete="new-password"
          inputClass={inputClass}
          onToggleShow={() => setShow((v) => !v)}
          hint={
            tooShort
              ? `${MIN - password.length} more character${MIN - password.length === 1 ? '' : 's'} to go`
              : undefined
          }
        />

        <Field
          id="confirm-password"
          label="Confirm password"
          value={confirm}
          onChange={setConfirm}
          show={show}
          autoComplete="new-password"
          inputClass={inputClass}
          onToggleShow={() => setShow((v) => !v)}
          hint={mismatch ? 'These do not match yet' : undefined}
        />

        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}

        <button
          disabled={!ready}
          className="w-full rounded-pill bg-brand px-5 py-2.5 text-sm font-medium text-brand-foreground transition duration-150 ease-out hover:scale-[1.02] hover:bg-brand-hover active:scale-100 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:scale-100"
        >
          {busy ? 'Saving...' : 'Set new password'}
        </button>
      </form>
    </Card>
  );
}

/** Same shell AuthPanel uses, so a reset does not look like a different site. */
function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="w-full max-w-sm rounded-card border border-border-hairline bg-surface/70 p-6 shadow-lg backdrop-blur-xl">
      <p className="mb-4 text-xs font-semibold tracking-[0.14em] text-brand-accent">UBC FLOW</p>
      {children}
    </div>
  );
}

/**
 * A labelled field with one show/hide control. Labels rather than placeholders
 * alone: a placeholder vanishes the moment you type, which on a form asking
 * for the same secret twice is exactly when you want to know which box you
 * are in. The toggle matters more here than on a login form, because nothing
 * you type is something you already know.
 */
function Field({
  id,
  label,
  value,
  onChange,
  show,
  onToggleShow,
  autoComplete,
  inputClass,
  hint,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  show: boolean;
  onToggleShow: () => void;
  autoComplete: string;
  inputClass: string;
  hint?: string;
}) {
  return (
    <div>
      <label htmlFor={id} className="block text-xs font-medium text-text-secondary">
        {label}
      </label>
      <div className="relative mt-1.5">
        <input
          id={id}
          name={id}
          type={show ? 'text' : 'password'}
          required
          minLength={MIN}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete}
          className={inputClass}
        />
        <button
          type="button"
          onClick={onToggleShow}
          aria-label={show ? 'Hide password' : 'Show password'}
          className="absolute inset-y-0 right-0 flex items-center px-3 text-xs font-medium text-text-secondary hover:text-foreground"
        >
          {show ? 'Hide' : 'Show'}
        </button>
      </div>
      {hint && <p className="mt-1 text-xs text-text-tertiary">{hint}</p>}
    </div>
  );
}
