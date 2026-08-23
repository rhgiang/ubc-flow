'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { signIn } from 'next-auth/react';
import { registerUser } from '@/app/actions/auth';

type Mode = 'login' | 'signup';

// One panel, two modes, switched entirely with local state — never a
// navigation. Used inline on the homepage, inside the global overlay
// (onSuccess/onClose supplied so it closes instead of redirecting), and as
// the content of the standalone /login and /signup routes (no callbacks,
// so it falls back to navigating after success).
export default function AuthPanel({
  initialMode = 'login',
  onSuccess,
  onClose,
  className = '',
}: {
  initialMode?: Mode;
  onSuccess?: () => void;
  onClose?: () => void;
  className?: string;
}) {
  const [mode, setMode] = useState<Mode>(initialMode);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function onLoginSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);

    const form = new FormData(e.currentTarget);
    const result = await signIn('credentials', {
      email: String(form.get('email')),
      password: String(form.get('password')),
      redirect: false,
    });

    if (result?.error) {
      // Deliberately does not say WHICH was wrong — that would let an attacker
      // enumerate which emails have accounts.
      setError('Invalid email or password.');
      setBusy(false);
      return;
    }
    setBusy(false);
    if (onSuccess) {
      onSuccess();
      router.refresh();
    } else {
      router.push('/');
      router.refresh();
    }
  }

  async function onSignupSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);

    const form = new FormData(e.currentTarget);
    const email = String(form.get('email'));
    const password = String(form.get('password'));

    const result = await registerUser(email, password);
    if (!result.ok) {
      setError(result.error);
      setBusy(false);
      return;
    }

    await signIn('credentials', { email, password, redirect: false });
    setBusy(false);
    // Unlike login, signup always continues to onboarding (enrolment
    // verification is the required next step) — onSuccess just closes the
    // overlay first if this panel is rendered inside one, so it doesn't
    // stay mounted mid-navigation.
    onSuccess?.();
    router.push('/onboarding');
  }

  const inputClass =
    'w-full rounded-input border border-border bg-background/60 px-4 py-2.5 text-sm text-foreground placeholder:text-text-tertiary focus:border-foreground focus:outline-none';

  return (
    <div
      className={`w-full max-w-sm rounded-card border border-border-hairline bg-surface/70 p-6 shadow-lg backdrop-blur-xl ${className}`}
    >
      <div className="flex items-center justify-between">
        <p className="text-lg font-semibold text-foreground">
          {mode === 'login' ? 'Log In' : 'Sign Up'}
        </p>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-full p-1 text-text-secondary transition-transform duration-150 ease-out hover:scale-110 hover:bg-surface-muted hover:text-foreground active:scale-100"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="h-5 w-5">
              <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
            </svg>
          </button>
        )}
      </div>

      {mode === 'login' ? (
        <form key="login" onSubmit={onLoginSubmit} className="mt-4 space-y-3">
          <input name="email" type="email" required placeholder="Email" className={inputClass} />
          <input
            name="password"
            type="password"
            required
            placeholder="Password"
            className={inputClass}
          />
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button
            disabled={busy}
            className="w-full rounded-pill bg-brand px-5 py-2.5 text-sm font-medium text-brand-foreground transition duration-150 ease-out hover:scale-[1.02] hover:bg-brand-hover active:scale-100 disabled:opacity-50"
          >
            {busy ? 'Logging in…' : 'Log In'}
          </button>
        </form>
      ) : (
        <form key="signup" onSubmit={onSignupSubmit} className="mt-4 space-y-3">
          <input name="email" type="email" required placeholder="Email" className={inputClass} />
          <input
            name="password"
            type="password"
            required
            minLength={10}
            placeholder="Password (10+ characters)"
            className={inputClass}
          />
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button
            disabled={busy}
            className="w-full rounded-pill bg-brand px-5 py-2.5 text-sm font-medium text-brand-foreground transition duration-150 ease-out hover:scale-[1.02] hover:bg-brand-hover active:scale-100 disabled:opacity-50"
          >
            {busy ? 'Creating…' : 'Sign Up'}
          </button>
        </form>
      )}

      <div className="my-4 flex items-center gap-3">
        <div className="h-px flex-1 bg-border" />
        <span className="text-xs text-text-tertiary">Or</span>
        <div className="h-px flex-1 bg-border" />
      </div>

      {/* Not wired up yet — OAuth providers land in a later phase. */}
      <div className="space-y-2">
        <button
          type="button"
          className="flex w-full items-center justify-center gap-2 rounded-pill border border-border px-5 py-2.5 text-sm font-medium text-foreground transition duration-150 ease-out hover:scale-[1.02] hover:bg-surface-muted active:scale-100"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4">
            <path
              fill="#4285F4"
              d="M23.52 12.27c0-.85-.08-1.67-.22-2.45H12v4.64h6.47a5.53 5.53 0 0 1-2.4 3.63v3h3.88c2.27-2.09 3.57-5.17 3.57-8.82Z"
            />
            <path
              fill="#34A853"
              d="M12 24c3.24 0 5.96-1.07 7.95-2.91l-3.88-3c-1.08.72-2.45 1.15-4.07 1.15-3.13 0-5.78-2.11-6.73-4.96H1.26v3.1A12 12 0 0 0 12 24Z"
            />
            <path
              fill="#FBBC05"
              d="M5.27 14.28A7.2 7.2 0 0 1 4.89 12c0-.79.14-1.56.38-2.28v-3.1H1.26A12 12 0 0 0 0 12c0 1.94.46 3.77 1.26 5.38l4.01-3.1Z"
            />
            <path
              fill="#EA4335"
              d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.44-3.44C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.69 1.26 6.62l4.01 3.1C6.22 6.86 8.87 4.75 12 4.75Z"
            />
          </svg>
          Continue with Google
        </button>
        <button
          type="button"
          className="flex w-full items-center justify-center gap-2 rounded-pill border border-border px-5 py-2.5 text-sm font-medium text-foreground transition duration-150 ease-out hover:scale-[1.02] hover:bg-surface-muted active:scale-100"
        >
          <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4">
            <path d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zm3.395-3.156c.833-1.01 1.39-2.415 1.234-3.815-1.196.052-2.64.803-3.5 1.812-.773.895-1.44 2.325-1.26 3.7 1.352.104 2.72-.688 3.526-1.697" />
          </svg>
          Continue with Apple
        </button>
      </div>

      <p className="mt-4 text-center text-sm text-text-secondary">
        {mode === 'login' ? (
          <>
            New to UBC Flow?{' '}
            <button
              type="button"
              onClick={() => {
                setError(null);
                setMode('signup');
              }}
              className="inline-block font-medium text-brand-accent transition-transform duration-150 ease-out hover:scale-105 hover:underline active:scale-100"
            >
              Sign up
            </button>
          </>
        ) : (
          <>
            Already have an account?{' '}
            <button
              type="button"
              onClick={() => {
                setError(null);
                setMode('login');
              }}
              className="inline-block font-medium text-brand-accent transition-transform duration-150 ease-out hover:scale-105 hover:underline active:scale-100"
            >
              Log in
            </button>
          </>
        )}
      </p>
    </div>
  );
}
