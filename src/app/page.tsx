import Link from 'next/link';
import { searchCourses } from '@/lib/search';

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q = '' } = await searchParams;
  const results = q ? await searchCourses(q) : [];

  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <h1 className="text-4xl font-semibold">UBC Flow</h1>
      <p className="mt-2 text-slate-600">Find courses and professors at UBC.</p>

      <form className="mt-8 flex gap-2">
        <input
          name="q"
          defaultValue={q}
          placeholder="Try CPSC 221, or “data structures”"
          className="flex-1 rounded-lg border px-4 py-2"
        />
        <button className="rounded-lg bg-blue-700 px-5 py-2 text-white">Search</button>
      </form>

      {q && (
        <section className="mt-10">
          <p className="text-sm text-slate-500">
            {results.length} result{results.length === 1 ? '' : 's'} for “{q}”
          </p>
          <ul className="mt-4 divide-y">
            {results.map((r) => (
              <li key={r.code} className="py-3">
                <Link
                  href={`/course/${r.code.toLowerCase().replace(' ', '-')}`}
                  className="font-medium text-blue-700 hover:underline"
                >
                  {r.code}
                </Link>
                <span className="ml-2 text-slate-700">{r.title}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="mt-12">
        <Link href="/explore" className="text-blue-700 hover:underline">
          Browse all subjects →
        </Link>
      </p>
    </main>
  );
}
