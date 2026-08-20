import { notFound, redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import Button from '@/components/Button';
import WeekGrid, { type WeekGridEntry } from '@/components/WeekGrid';
import { findConflicts } from '@/schedule/conflicts';
import { searchSectionsForTerm } from '@/lib/search';
import {
  renameSchedule,
  deleteSchedule,
  addSection,
  removeSection,
  getSubscribeUrl,
} from '@/app/actions/schedule';

export default async function SchedulePlannerPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  const { id } = await params;
  const { q = '' } = await searchParams;
  const session = await auth();
  if (!session?.user?.id) redirect('/login');

  // Filtering by userId here IS the ownership check (same rule Task 4's
  // actions enforce): a schedule that exists but belongs to someone else
  // simply doesn't match, so this 404s exactly like a missing schedule.
  const schedule = await db.savedSchedule.findFirst({
    where: { id, userId: session.user.id },
    include: { sections: true },
  });
  if (!schedule) notFound();

  const term = await db.term.findUnique({ where: { id: schedule.termId } });

  const sectionIds = schedule.sections.map((s) => s.sectionId);
  // ponytail: ScheduleSection.sectionId is a raw FK with no Prisma relation to
  // Section (same convention as the calendar route in Task 5), so this is a
  // second query rather than a nested include.
  const sections = sectionIds.length
    ? await db.section.findMany({
        where: { id: { in: sectionIds } },
        include: { meetingTimes: true, course: { include: { subject: true } } },
      })
    : [];

  const entries: WeekGridEntry[] = sections.flatMap((s) => {
    const label = `${s.course.subject.code} ${s.course.number} ${s.sectionCode}`;
    return s.meetingTimes.map((m) => ({
      id: m.id,
      sectionId: s.id,
      label,
      day: m.day,
      startTime: m.startTime,
      endTime: m.endTime,
      location: m.building ? `${m.building}${m.room ? ` ${m.room}` : ''}` : null,
    }));
  });

  const conflicts = findConflicts(entries);

  const scheduleId = schedule.id;
  const addedIds = new Set(sectionIds);
  const results = q ? await searchSectionsForTerm(q, schedule.termId) : [];

  const subscribe = await getSubscribeUrl(scheduleId);
  const base = process.env.NEXTAUTH_URL ?? 'http://localhost:3000';
  const subscribeUrl = subscribe.ok ? `${base}/api/calendar/${subscribe.token}` : null;
  // webcal:// makes iOS/macOS/Outlook offer a real subscription rather than a
  // one-off download, so the feed keeps updating — the whole point of it.
  const webcalUrl = subscribeUrl ? subscribeUrl.replace(/^https?:\/\//, 'webcal://') : null;
  // Google Calendar ignores webcal:// and needs its own deep link.
  const googleUrl = subscribeUrl
    ? `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcalUrl ?? subscribeUrl)}`
    : null;

  async function renameAction(formData: FormData) {
    'use server';
    await renameSchedule(scheduleId, String(formData.get('name') ?? ''));
  }

  async function deleteAction() {
    'use server';
    await deleteSchedule(scheduleId);
    redirect('/schedule');
  }

  async function removeAction(formData: FormData) {
    'use server';
    await removeSection(scheduleId, String(formData.get('sectionId') ?? ''));
  }

  async function addAction(formData: FormData) {
    'use server';
    await addSection(scheduleId, String(formData.get('sectionId') ?? ''));
  }

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm text-slate-500">{term?.name ?? 'Unknown term'}</p>
          <h1 className="text-3xl font-semibold">{schedule.name}</h1>
        </div>
        <form action={deleteAction}>
          <Button type="submit" variant="danger">
            Delete schedule
          </Button>
        </form>
      </div>

      <form action={renameAction} className="mt-4 flex max-w-sm gap-2">
        <input
          name="name"
          defaultValue={schedule.name}
          required
          maxLength={80}
          className="flex-1 rounded-lg border px-3 py-2 text-sm"
        />
        <Button type="submit" variant="secondary">
          Rename
        </Button>
      </form>

      <div className="mt-8 grid gap-8 lg:grid-cols-[320px_1fr]">
        {/* Search sidebar — GET form, same ?q= pattern as the site-wide
            search, so it needs no client-side JS. */}
        <aside>
          <h2 className="text-lg font-semibold">Add sections</h2>
          <p className="mt-1 text-xs text-slate-500">
            Searching {term?.name ?? 'this term'} only.
          </p>
          <form className="mt-3 flex gap-2">
            <input
              name="q"
              defaultValue={q}
              placeholder="e.g. CPSC 221"
              className="min-w-0 flex-1 rounded-lg border px-3 py-2 text-sm"
            />
            <Button type="submit" variant="secondary">
              Search
            </Button>
          </form>

          {q && (
            <p className="mt-3 text-xs text-slate-500">
              {results.length} section{results.length === 1 ? '' : 's'} found
            </p>
          )}

          <ul className="mt-3 max-h-[60vh] space-y-2 overflow-y-auto pr-1">
            {results.map((r) => {
              const added = addedIds.has(r.sectionId);
              return (
                <li key={r.sectionId} className="rounded-lg border p-3 text-sm">
                  <p className="font-medium">
                    {r.code} {r.sectionCode}
                  </p>
                  <p className="truncate text-xs text-slate-600">{r.title}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    {r.activity ?? '—'} · {r.meetings}
                  </p>
                  {added ? (
                    <p className="mt-2 text-xs font-medium text-slate-400">Already added</p>
                  ) : (
                    <form action={addAction} className="mt-2">
                      <input type="hidden" name="sectionId" value={r.sectionId} />
                      <Button type="submit" variant="secondary">
                        Add
                      </Button>
                    </form>
                  )}
                </li>
              );
            })}
          </ul>
        </aside>

        <div>
      {conflicts.length > 0 && (
        <div className="rounded-lg border border-red-600 bg-red-50 p-4 text-sm text-red-800">
          <p className="font-medium">
            {conflicts.length} scheduling conflict{conflicts.length === 1 ? '' : 's'} detected
          </p>
          <ul className="mt-2 space-y-1">
            {conflicts.map((c, i) => (
              <li key={i}>
                {c.a.label} overlaps {c.b.label} on {c.a.day}
              </li>
            ))}
          </ul>
        </div>
      )}

      <h2 className={`text-xl font-semibold ${conflicts.length > 0 ? 'mt-8' : ''}`}>
        Weekly view
      </h2>
      <div className="mt-4">
        <WeekGrid entries={entries} />
      </div>

      <h2 className="mt-8 text-xl font-semibold">Sections</h2>
      {sections.length === 0 ? (
        <p className="mt-2 text-slate-500">No sections added yet. Add some from a course page.</p>
      ) : (
        <ul className="mt-4 divide-y">
          {sections.map((s) => (
            <li key={s.id} className="flex items-center justify-between py-3">
              <div>
                <p className="font-medium">
                  {s.course.subject.code} {s.course.number} {s.sectionCode}
                </p>
                <p className="text-sm text-slate-500">{s.activity ?? '—'}</p>
              </div>
              <form action={removeAction}>
                <input type="hidden" name="sectionId" value={s.id} />
                <Button type="submit" variant="secondary">
                  Remove
                </Button>
              </form>
            </li>
          ))}
        </ul>
      )}

      <h2 className="mt-8 text-xl font-semibold">Add to your calendar</h2>
      {subscribeUrl ? (
        <>
          <p className="mt-2 text-sm text-slate-600">
            These subscribe to a live feed — your calendar keeps updating as you edit this
            schedule, with no need to re-export.
          </p>
          <div className="mt-3 flex flex-wrap gap-3">
            <a
              href={webcalUrl ?? subscribeUrl}
              className="rounded-lg bg-blue-700 px-5 py-2 text-sm text-white"
            >
              Add to Apple / Outlook
            </a>
            <a
              href={googleUrl ?? subscribeUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-lg border px-5 py-2 text-sm text-slate-700"
            >
              Add to Google Calendar
            </a>
          </div>
          <p className="mt-4 text-xs text-slate-500">
            Or paste this URL into any calendar app&apos;s &quot;subscribe by URL&quot; option:
          </p>
          <input
            readOnly
            value={subscribeUrl}
            className="mt-1 w-full rounded-lg border bg-slate-50 px-3 py-2 text-sm"
          />
        </>
      ) : (
        <p className="mt-2 text-sm text-red-700">Could not create a subscribe link.</p>
      )}
        </div>
      </div>
    </main>
  );
}
