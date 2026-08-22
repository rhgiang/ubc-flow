import Link from 'next/link';
import { searchCourses } from '@/lib/search';
import { auth } from '@/lib/auth';
import AuthPanel from '@/components/AuthPanel';
import SearchBar from '@/components/SearchBar';

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q = '' } = await searchParams;
  const { hits, total } = q ? await searchCourses(q) : { hits: [], total: 0 };
  const truncated = q !== '' && hits.length < total;
  const session = await auth();

  return (
    <main
      className={
        q
          ? 'flex-1 overflow-y-auto px-6 py-16'
          : 'flex flex-1 flex-col items-center justify-center px-6'
      }
    >
      <div
        className={`mx-auto w-full max-w-2xl text-center ${
          // With no login panel below it, the block reads as sitting too low
          // dead-centered in the viewport — nudge it up to roughly where it
          // sits when the panel is present.
          !q && session?.user ? 'mb-24' : ''
        }`}
      >
        <h1 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
          Search and explore course and professor reviews from UBC students
        </h1>

        <SearchBar defaultValue={q} />

        {!q && !session?.user && (
          <div className="mt-10 flex justify-center">
            <AuthPanel initialMode="login" />
          </div>
        )}
      </div>

      {q && (
        <section className="mx-auto mt-10 max-w-2xl text-left">
          <p className="text-sm text-text-secondary">
            {truncated
              ? `Showing ${hits.length} of ${total} results for "${q}" — refine your search to narrow this down`
              : `${total} result${total === 1 ? '' : 's'} for "${q}"`}
          </p>
          <ul className="mt-4 divide-y divide-border">
            {hits.map((r) => (
              <li key={r.code} className="py-3">
                <Link
                  href={`/course/${r.code.toLowerCase().replace(' ', '-')}`}
                  className="font-medium text-foreground hover:underline"
                >
                  {r.code}
                </Link>
                <span className="ml-2 text-text-secondary">{r.title}</span>
              </li>
            ))}
          </ul>

          <p className="mt-8">
            <Link href="/explore" className="text-sm text-foreground hover:underline">
              Browse all subjects →
            </Link>
          </p>
        </section>
      )}
    </main>
  );
}
