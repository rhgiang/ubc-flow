import ResetPasswordForm from '@/components/ResetPasswordForm';

export default async function ResetPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  return (
    <main className="flex flex-1 items-center justify-center px-6 py-16">
      <ResetPasswordForm token={token ?? null} />
    </main>
  );
}
