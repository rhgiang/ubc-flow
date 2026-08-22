import AuthPanel from '@/components/AuthPanel';

export default function LoginPage() {
  return (
    <main className="flex flex-1 items-center justify-center px-6 py-16">
      <AuthPanel initialMode="login" />
    </main>
  );
}
