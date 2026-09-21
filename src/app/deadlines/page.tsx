// src/app/deadlines/page.tsx
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { LEAD_CHOICES } from '@/canvas/prefs';
import { formatVancouver } from '@/canvas/tz';
import { RECENT_MS, stillWorthShowing } from '@/canvas/notices';
import DeadlinesList from '@/components/DeadlinesList';

type DeadlineFields = {
  id: string;
  title: string;
  courseName: string;
  dueAt: Date;
  allDay: boolean;
  url: string | null;
  movedFrom: Date | null;
  movedAt: Date | null;
  removedAt: Date | null;
};

/**
 * Plain fields to the JSON-serializable shape DeadlinesList takes. `now` is
 * passed in rather than read here with Date.now(), which the render-purity
 * lint rule (react-hooks/purity) flags when called directly in a component
 * body - see src/schedule/terms.ts's currentOrdinal() for the same shape.
 * A deletion older than two weeks is no longer news; the caller drops those
 * rows entirely rather than growing the page forever.
 */
function currentTimeMs(): number {
  return Date.now();
}

/**
 * Dates are formatted HERE, on the server, and travel as finished strings.
 * They used to travel as ISO and get formatted in the client component, which
 * looked equivalent and was not: Node's ICU and a browser's bundled ICU can
 * hold different tzdata, and they disagree about America/Vancouver after
 * November 2026. That produced a React hydration mismatch on every deadline
 * past that date, and left the page an hour off from the reminder email,
 * which formats with the same helper on the server. Formatting once, server
 * side, is the only way the page, the email and every browser agree.
 */
function toRow(d: DeadlineFields, now: number) {
  const movedFrom =
    d.movedAt && now - d.movedAt.getTime() <= RECENT_MS && d.movedFrom ? d.movedFrom : null;
  return {
    id: d.id,
    title: d.title,
    courseName: d.courseName,
    url: d.url,
    removed: Boolean(d.removedAt),
    dueLabel: formatVancouver(d.dueAt, d.allDay),
    dayLabel: formatVancouver(d.dueAt, true),
    movedFromLabel: movedFrom ? formatVancouver(movedFrom, d.allDay) : null,
  };
}

export default async function DeadlinesPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');
  const userId = session.user.id;

  const [feed, preference, deadlines] = await Promise.all([
    db.canvasFeed.findUnique({
      where: { userId },
      select: { connectedAt: true, lastFetchedAt: true, brokenAt: true, failureCount: true },
    }),
    db.reminderPreference.findUnique({
      where: { userId },
      select: { enabled: true, leadHours: true, mutedCourses: true },
    }),
    db.canvasDeadline.findMany({
      where: { userId },
      orderBy: { dueAt: 'asc' },
      select: {
        id: true,
        title: true,
        courseName: true,
        dueAt: true,
        allDay: true,
        url: true,
        movedFrom: true,
        movedAt: true,
        removedAt: true,
      },
    }),
  ]);

  if (!feed) {
    return (
      <main className="mx-auto w-full max-w-2xl px-4 py-10 sm:px-6">
        <h1 className="text-2xl font-semibold text-foreground">Deadlines</h1>
        <p className="mt-3 text-sm text-text-secondary">
          Connect your Canvas calendar to see every deadline in one place. Head to{' '}
          <Link href="/onboarding" className="font-medium text-brand-accent hover:underline">
            your Account page
          </Link>{' '}
          to connect it.
        </p>
      </main>
    );
  }

  const now = currentTimeMs();
  const rows = deadlines.filter((d) => stillWorthShowing(d, now)).map((d) => toRow(d, now));

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-10 sm:px-6">
      <h1 className="text-2xl font-semibold text-foreground">Deadlines</h1>
      <DeadlinesList
        connectedLabel={formatVancouver(feed.connectedAt, true)}
        lastReadLabel={feed.lastFetchedAt ? formatVancouver(feed.lastFetchedAt, false) : null}
        broken={Boolean(feed.brokenAt)}
        failing={feed.failureCount > 0 && !feed.brokenAt}
        enabled={preference?.enabled ?? true}
        leadHours={preference?.leadHours ?? []}
        mutedCourses={preference?.mutedCourses ?? []}
        leadChoices={LEAD_CHOICES}
        deadlines={rows}
      />
    </main>
  );
}
