import { redirect } from 'next/navigation';
import Link from 'next/link';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import Button from '@/components/Button';
import { createSchedule } from '@/app/actions/schedule';
import { isPlannableTerm } from '@/schedule/terms';

export default async function SchedulePage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');
  const userId = session.user.id;

  const [schedules, terms] = await Promise.all([
    db.savedSchedule.findMany({
      where: { userId },
      include: { _count: { select: { sections: true } } },
    }),
    // SavedSchedule.termId is a raw FK (same cross-domain convention as
    // ScheduleSection.sectionId) — no Prisma relation, so terms are fetched
    // separately and joined in JS.
    db.term.findMany({
      where: { campus: 'V' },
      orderBy: [{ year: 'desc' }, { termNumber: 'desc' }],
    }),
  ]);

  const termById = new Map(terms.map((t) => [t.id, t]));
  // Existing schedules (termById, above) still show their real term even if
  // it's since passed — only NEW schedules are restricted to what's ahead.
  const plannableTerms = terms.filter(isPlannableTerm);
  const sorted = [...schedules].sort((a, b) => {
    const ta = termById.get(a.termId);
    const tb = termById.get(b.termId);
    return (
      (tb?.year ?? 0) - (ta?.year ?? 0) ||
      (tb?.termNumber ?? 0) - (ta?.termNumber ?? 0) ||
      a.name.localeCompare(b.name)
    );
  });

  async function createScheduleAction(formData: FormData) {
    'use server';
    const result = await createSchedule(
      String(formData.get('termId') ?? ''),
      String(formData.get('name') ?? ''),
    );
    if (result.ok) redirect(`/schedule/${result.scheduleId}`);
  }

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <h1 className="text-3xl font-semibold">My Schedules</h1>

      <form
        action={createScheduleAction}
        className="mt-6 flex flex-wrap items-end gap-3 rounded-lg border p-4"
      >
        <div className="min-w-[160px] flex-1">
          <label htmlFor="name" className="block text-xs text-slate-500">
            Name
          </label>
          <input
            id="name"
            name="name"
            required
            maxLength={80}
            placeholder="e.g. Term 1 draft"
            className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label htmlFor="termId" className="block text-xs text-slate-500">
            Term
          </label>
          <select
            id="termId"
            name="termId"
            required
            className="mt-1 rounded-lg border px-3 py-2 text-sm"
          >
            {plannableTerms.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit">Create</Button>
      </form>

      {sorted.length === 0 ? (
        <p className="mt-8 text-slate-500">You haven&apos;t created any schedules yet.</p>
      ) : (
        <ul className="mt-8 divide-y">
          {sorted.map((s) => {
            const term = termById.get(s.termId);
            return (
              <li key={s.id} className="py-3">
                <Link
                  href={`/schedule/${s.id}`}
                  className="font-medium text-blue-700 hover:underline"
                >
                  {s.name}
                </Link>
                <p className="mt-1 text-sm text-slate-500">
                  {term?.name ?? 'Unknown term'} · {s._count.sections} section
                  {s._count.sections === 1 ? '' : 's'}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
