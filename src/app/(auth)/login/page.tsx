'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { signIn } from 'next-auth/react';

export default function LoginPage() {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
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
    router.push('/');
  }

  return (
    <main className="mx-auto max-w-md px-6 py-16">
      <h1 className="text-3xl font-semibold">Log in</h1>

      <form onSubmit={onSubmit} className="mt-8 space-y-4">
        <input
          name="email"
          type="email"
          required
          placeholder="you@example.com"
          className="w-full rounded-lg border px-4 py-2"
        />
        <input
          name="password"
          type="password"
          required
          placeholder="Password"
          className="w-full rounded-lg border px-4 py-2"
        />
        {error && <p className="text-sm text-red-700">{error}</p>}
        <button
          disabled={busy}
          className="w-full rounded-lg bg-blue-700 px-5 py-2 text-white disabled:opacity-50"
        >
          {busy ? 'Signing in…' : 'Log in'}
        </button>
      </form>

      <p className="mt-6 text-sm text-slate-600">
        Need an account?{' '}
        <Link href="/signup" className="text-blue-700 hover:underline">
          Sign up
        </Link>
      </p>
    </main>
  );
}
