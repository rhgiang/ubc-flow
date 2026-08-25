import { auth } from '@/lib/auth';
import AuthPanel from '@/components/AuthPanel';
import SearchBar from '@/components/SearchBar';

export default async function Home() {
  const session = await auth();

  return (
    <main className="flex flex-1 flex-col items-center justify-center px-6">
      <div
        className={`mx-auto w-full max-w-2xl text-center ${
          // With no login panel below it, the block reads as sitting too low
          // dead-centered in the viewport — nudge it up well above center.
          session?.user ? 'mb-48' : ''
        }`}
      >
        <h1 className="sky-hero text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
          Search and explore course and professor reviews from UBC students
        </h1>

        <SearchBar defaultValue="" />

        {!session?.user && (
          <div className="mt-10 flex justify-center">
            <AuthPanel initialMode="login" />
          </div>
        )}
      </div>
    </main>
  );
}
