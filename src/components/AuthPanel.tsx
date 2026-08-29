'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { signIn } from 'next-auth/react';
import { registerUser } from '@/app/actions/auth';
import { requestPasswordReset } from '@/app/actions/password-reset';

type Mode = 'login' | 'signup' | 'forgot';

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
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  function go(next: Mode) {
    setError(null);
    setSent(false);
    setMode(next);
  }

  async function onLoginSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);

    const form = new FormData(e.currentTarget);
    try {
      const result = await signIn('credentials', {
        email: String(form.get('email')),
        password: String(form.get('password')),
        redirect: false,
      });

      if (result?.error) {
        // Deliberately does not say WHICH was wrong — that would let an attacker
        // enumerate which emails have accounts.
        setError('Invalid email or password.');
        return;
      }
      if (onSuccess) {
        onSuccess();
        router.refresh();
      } else {
        router.push('/');
        router.refresh();
      }
    } catch {
      // A REJECTED sign-in, as opposed to a rejected password: the request
      // never completed. Without this the button kept saying "Logging in…"
      // for as long as the page stayed open, with nothing said and nothing
      // to do but reload — the one failure a user cannot work around.
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  async function onSignupSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);

    const form = new FormData(e.currentTarget);
    const email = String(form.get('email'));
    const password = String(form.get('password'));

    try {
      const result = await registerUser(email, password);
      if (!result.ok) {
        setError(result.error);
        return;
      }

      // The account now EXISTS, so a failure past this point must not read as
      // "signup failed" — it sent the user to /onboarding signed out, which
      // is a page that needs a session, moments after telling them it worked.
      const signedIn = await signIn('credentials', { email, password, redirect: false });
      if (signedIn?.error) {
        setMode('login');
        setError('Account created — sign in to continue.');
        return;
      }

      // Unlike login, signup always continues to onboarding (enrolment
      // verification is the required next step) — onSuccess just closes the
      // overlay first if this panel is rendered inside one, so it doesn't
      // stay mounted mid-navigation.
      onSuccess?.();
      router.push('/onboarding');
    } catch {
      setError('Could not create your account right now. Try again in a moment.');
    } finally {
      setBusy(false);
    }
  }

  async function onForgotSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const form = new FormData(e.currentTarget);
    try {
      await requestPasswordReset(String(form.get('email')));
      // Always the same acknowledgement. The action deliberately does not tell us
      // whether that address has an account, so neither can this.
      setSent(true);
    } catch {
      setError('Could not send the reset link. Try again in a moment.');
    } finally {
      setBusy(false);
    }
  }

  const inputClass =
    'w-full rounded-input border border-border bg-background/60 px-4 py-2.5 text-sm text-foreground placeholder:text-text-tertiary focus:border-foreground focus:outline-none';

  return (
    <div
      className={`w-full max-w-sm rounded-card border border-border-hairline bg-surface/70 p-6 shadow-lg backdrop-blur-xl ${className}`}
    >
      <div className="flex items-center justify-between">
        <p className="text-lg font-semibold text-foreground">
          {mode === 'login' ? 'Log In' : mode === 'signup' ? 'Sign Up' : 'Reset Password'}
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

      {mode === 'forgot' ? (
        sent ? (
          <p className="mt-4 text-sm text-text-secondary">
            If an account exists for that address, a reset link is on its way. It works once and
            expires in an hour.
          </p>
        ) : (
          <form key="forgot" onSubmit={onForgotSubmit} className="mt-4 space-y-3">
            <p className="text-sm text-text-secondary">
              Enter your email and we&rsquo;ll send a link to set a new password.
            </p>
            <input name="email" type="email" required placeholder="Email" className={inputClass} />
            {error && <p role="alert" className="text-sm text-danger">{error}</p>}
            <button
              disabled={busy}
              className="w-full rounded-pill bg-brand px-5 py-2.5 text-sm font-medium text-brand-foreground transition duration-150 ease-out hover:scale-[1.02] hover:bg-brand-hover active:scale-100 disabled:opacity-50"
            >
              {busy ? 'Sending…' : 'Send reset link'}
            </button>
          </form>
        )
      ) : mode === 'login' ? (
        <form key="login" onSubmit={onLoginSubmit} className="mt-4 space-y-3">
          <input name="email" type="email" required placeholder="Email" className={inputClass} />
          <input
            name="password"
            type="password"
            required
            placeholder="Password"
            className={inputClass}
          />
          {error && <p role="alert" className="text-sm text-danger">{error}</p>}
          <button
            disabled={busy}
            className="w-full rounded-pill bg-brand px-5 py-2.5 text-sm font-medium text-brand-foreground transition duration-150 ease-out hover:scale-[1.02] hover:bg-brand-hover active:scale-100 disabled:opacity-50"
          >
            {busy ? 'Logging in…' : 'Log In'}
          </button>
          <button
            type="button"
            onClick={() => go('forgot')}
            className="block w-full text-center text-sm text-text-secondary hover:text-foreground hover:underline"
          >
            Forgot password?
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
          {error && <p role="alert" className="text-sm text-danger">{error}</p>}
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

      {/*
        The redirect to Google is not instant, and with nothing changing on
        the button a slow connection reads as a dead click — so it got clicked
        again, starting a second OAuth round trip. It stays disabled after
        success too: the page is on its way out, and re-enabling it would just
        offer the same trip again.
      */}
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            await signIn('google', { callbackUrl: '/onboarding' });
          } catch {
            setError('Could not reach Google. Try again in a moment.');
            setBusy(false);
          }
        }}
        className="flex w-full items-center justify-center gap-2 rounded-pill border border-border px-5 py-2.5 text-sm font-medium text-foreground transition duration-150 ease-out hover:scale-[1.02] hover:bg-surface-muted active:scale-100 disabled:opacity-50"
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
        {busy ? 'Redirecting…' : 'Continue with Google'}
      </button>

      <p className="mt-4 text-center text-sm text-text-secondary">
        {mode === 'forgot' ? (
          <button
            type="button"
            onClick={() => go('login')}
            className="inline-block font-medium text-brand-accent transition-transform duration-150 ease-out hover:scale-105 hover:underline active:scale-100"
          >
            Back to log in
          </button>
        ) : mode === 'login' ? (
          <>
            New to UBC Flow?{' '}
            <button
              type="button"
              onClick={() => go('signup')}
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
              onClick={() => go('login')}
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
