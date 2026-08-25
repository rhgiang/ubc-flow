import { auth } from '@/lib/auth';
import AuthPanel from '@/components/AuthPanel';
import SearchBar from '@/components/SearchBar';

export default async function Home() {
  const session = await auth();

  return (
    // Anchored to the upper third rather than dead-centered: the hero owns
    // the top of the viewport whether or not the login panel renders below,
    // which also retires the old logged-in-only mb-48 nudge.
    <main className="flex flex-1 flex-col items-center px-6 pt-[14vh] sm:pt-[16vh]">
      <div className="mx-auto w-full max-w-2xl text-center">
        <h1 className="sky-hero text-balance text-3xl font-semibold leading-[1.15] tracking-tight text-foreground sm:text-4xl">
          Search and explore course and professor reviews from UBC students
        </h1>

        <SearchBar defaultValue="" />

        {!session?.user && (
          <div className="mt-12 flex justify-center pb-16">
            <AuthPanel initialMode="login" />
          </div>
        )}
      </div>
    </main>
  );
}
