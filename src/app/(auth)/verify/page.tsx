import Link from 'next/link';
import { consumeVerificationToken } from '@/lib/mail';

export default async function VerifyPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  const result = token ? await consumeVerificationToken(token) : { ok: false };

  return (
    <main className="mx-auto w-full max-w-md px-6 py-16">
      <h1 className="text-2xl font-semibold sm:text-3xl">
        {result.ok ? 'Email verified' : 'Link not valid'}
      </h1>
      <p className="mt-2 text-text-secondary">
        {result.ok
          ? 'Next, upload your Workday exports to finish setting up your account.'
          : 'That verification link is invalid or has expired. Request a new one from your account page.'}
      </p>
      <Link href="/onboarding" className="mt-6 inline-block text-brand-accent hover:underline">
        Continue to setup →
      </Link>
    </main>
  );
}
