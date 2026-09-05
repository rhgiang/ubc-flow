import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db } from '@/lib/db';
import { sectionHitInclude, toSectionHit } from '@/lib/search';
import SharedCalendar from './SharedCalendar';

/**
 * A saved schedule, read-only, for anyone holding the link.
 *
 * No session is consulted at all: the token IS the capability, the same way
 * the calendar feed works. That also means the page must never render anything
 * about its owner — it shows a timetable and the term it belongs to, and
 * nothing that identifies whose it is.
 */
export const dynamic = 'force-dynamic';

async function load(token: string) {
  const schedule = await db.savedSchedule.findUnique({
    where: { shareToken: token },
    select: { name: true, termId: true, sections: { select: { sectionId: true } } },
  });
  if (!schedule) return null;

  const ids = schedule.sections.map((s) => s.sectionId);
  const [sections, term] = await Promise.all([
    ids.length
      ? db.section.findMany({ where: { id: { in: ids } }, include: sectionHitInclude })
      : Promise.resolve([]),
    db.term.findUnique({ where: { id: schedule.termId }, select: { name: true } }),
  ]);
  return { name: schedule.name, termName: term?.name ?? null, sections: sections.map(toSectionHit) };
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<Metadata> {
  const data = await load((await params).token);
  // A shared link is pasted into group chats, so it gets a real preview — but
  // noindex, because these are personal and should never turn up in search.
  return {
    title: data ? `${data.name} · shared schedule` : 'Shared schedule',
    robots: { index: false, follow: false },
  };
}

export default async function SharedSchedulePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const data = await load((await params).token);
  // A revoked link and a link that never existed are the same 404 on purpose.
  if (!data) notFound();

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6">
      <div className="sky-hero">
        <p className="text-sm text-text-tertiary">
          Shared schedule{data.termName ? ` · ${data.termName}` : ''}
        </p>
        {/* The term already appears in the line above, so on a phone this
            heading was two lines of 30px type repeating it, directly above the
            calendar it was pushing down. */}
        <h1 className="text-xl font-semibold sm:text-3xl">{data.name}</h1>
      </div>

      <div className="sky-panel mt-6 p-3 sm:p-6">
        {data.sections.length === 0 ? (
          <p className="text-sm text-text-secondary">This schedule has no courses in it yet.</p>
        ) : (
          <SharedCalendar sections={data.sections} />
        )}
      </div>

      {/* The reason to host this on the site rather than hand out an image:
          whoever opened the link is looking at a timetable and may not have an
          account. */}
      <p className="sky-hero mt-6 text-sm">
        <Link href="/schedule" className="font-medium underline underline-offset-4">
          Build your own schedule
        </Link>{' '}
        on UBC Flow.
      </p>
    </main>
  );
}
