import Link from 'next/link';
import { db } from '@/lib/db';

export const revalidate = 3600;

export default async function Explore() {
  const subjects = await db.subject.findMany({
    where: { campus: 'V', code: { not: null } },
    include: { _count: { select: { courses: true } } },
    orderBy: { code: 'asc' },
  });

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <h1 className="text-3xl font-semibold">Browse subjects</h1>
      <ul className="mt-8 grid gap-3 sm:grid-cols-2">
        {subjects.map((s) => (
          <li key={s.id} className="rounded-lg border p-4">
            <Link href={`/?q=${s.code}`} className="font-medium text-blue-700 hover:underline">
              {s.code}
            </Link>
            <p className="text-sm text-slate-700">{s.name}</p>
            <p className="mt-1 text-xs text-slate-500">{s._count.courses} courses</p>
          </li>
        ))}
      </ul>
    </main>
  );
}
