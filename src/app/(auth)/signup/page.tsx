import AuthPanel from '@/components/AuthPanel';

export default function SignupPage() {
  return (
    <main className="flex flex-1 items-center justify-center px-6 py-16">
      <AuthPanel initialMode="signup" />
    </main>
  );
}
