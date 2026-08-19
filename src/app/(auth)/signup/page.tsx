'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { registerUser } from '@/app/actions/auth';
import { signIn } from 'next-auth/react';

export default function SignupPage() {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
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
    router.push('/onboarding');
  }

  return (
    <main className="mx-auto max-w-md px-6 py-16">
      <h1 className="text-3xl font-semibold">Create your account</h1>
      <p className="mt-2 text-slate-600">
        Any email works — you&apos;ll verify you&apos;re a UBC student in the next step.
      </p>

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
          minLength={10}
          placeholder="Password (10+ characters)"
          className="w-full rounded-lg border px-4 py-2"
        />
        {error && <p className="text-sm text-red-700">{error}</p>}
        <button
          disabled={busy}
          className="w-full rounded-lg bg-blue-700 px-5 py-2 text-white disabled:opacity-50"
        >
          {busy ? 'Creating…' : 'Create account'}
        </button>
      </form>

      <p className="mt-6 text-sm text-slate-600">
        Already have an account?{' '}
        <Link href="/login" className="text-blue-700 hover:underline">
          Log in
        </Link>
      </p>
    </main>
  );
}
