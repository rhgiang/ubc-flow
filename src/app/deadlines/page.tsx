// src/app/deadlines/page.tsx
import Link from 'next/link';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { LEAD_CHOICES } from '@/canvas/prefs';
import { formatVancouver, vancouverDayKey } from '@/canvas/tz';
import { isManualUid } from '@/canvas/diff';
import { shortCourseLabel } from '@/canvas/course-label';
import { RECENT_MS, stillWorthShowing } from '@/canvas/notices';
import DeadlinesList from '@/components/DeadlinesList';

type DeadlineFields = {
  id: string;
  uid: string;
  title: string;
  courseName: string;
  dueAt: Date;
  allDay: boolean;
  url: string | null;
  movedFrom: Date | null;
  movedAt: Date | null;
  removedAt: Date | null;
  completedAt: Date | null;
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
    /** Added by the student rather than read out of the feed. What it buys the
     *  list: a Remove control, since those rows are theirs to delete. */
    manual: isManualUid(d.uid),
    title: d.title,
    /** The raw bracket from Canvas. The identity: the colour hashes from it
     *  and a mute preference is stored under it. Never shown. */
    courseName: d.courseName,
    /** What the badge shows. */
    courseLabel: shortCourseLabel(d.courseName),
    url: d.url,
    removed: Boolean(d.removedAt),
    done: Boolean(d.completedAt),
    overdue: !d.completedAt && !d.removedAt && d.dueAt.getTime() < now,
    dueLabel: formatVancouver(d.dueAt, d.allDay),
    dayLabel: formatVancouver(d.dueAt, true),
    /** "2026-09-20". Groups the list and places the calendar square. */
    dayKey: vancouverDayKey(d.dueAt),
    /** Just the clock, for the compact row. Empty for an all-day item, whose
     *  11:59 p.m. is our convention rather than something a professor set. */
    timeLabel: d.allDay ? '' : d.dueAt.toLocaleTimeString('en-CA', { timeZone: 'America/Vancouver', hour: 'numeric', minute: '2-digit' }),
    relativeLabel: relativeDue(d.dueAt.getTime() - now),
    movedFromLabel: movedFrom ? formatVancouver(movedFrom, d.allDay) : null,
  };
}

const HOUR = 3600_000;

/** "in 3 days", "tomorrow", "2 days ago". Computed on the server against the
 *  same `now` the rest of the page uses, so it cannot drift from the list. */
function relativeDue(ms: number): string {
  const past = ms < 0;
  const abs = Math.abs(ms);
  const days = Math.round(abs / (24 * HOUR));
  if (abs < HOUR) return past ? 'just passed' : 'within the hour';
  if (abs < 24 * HOUR) {
    const hours = Math.round(abs / HOUR);
    return past ? `${hours}h ago` : `in ${hours}h`;
  }
  if (days === 1) return past ? 'yesterday' : 'tomorrow';
  return past ? `${days} days ago` : `in ${days} days`;
}

/** What a signed-out visitor gets from the Deadlines pill. */
function SignedOut() {
  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-10 sm:px-6">
      <h1 className="text-2xl font-semibold text-foreground">Deadlines</h1>
      <p className="mt-3 text-sm text-text-secondary">
        Connect your Canvas calendar once and every assignment due date across all your courses
        lands here. It refreshes on its own, tells you when an instructor moves something, and can
        email you before each deadline.
      </p>
      <p className="mt-4 text-sm">
        <Link href="/login" className="font-medium text-brand-accent hover:underline">
          Sign in to get started
        </Link>
      </p>
    </main>
  );
}

export default async function DeadlinesPage() {
  const session = await auth();
  // Not a redirect to /login. This is a nav pill now, so a signed-out
  // visitor will click it, and bouncing them into a bare login form says
  // nothing about what they would be signing in for. Same reasoning as
  // /schedule and /guidance: the page explains itself and login is what
  // personalises it, not what grants access.
  if (!session?.user?.id) return <SignedOut />;
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
        uid: true,
        title: true,
        courseName: true,
        dueAt: true,
        allDay: true,
        url: true,
        movedFrom: true,
        movedAt: true,
        removedAt: true,
        completedAt: true,
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

  // No max-width here: the list reads best narrow and a month grid needs the
  // room, so DeadlinesList sets its own width from whichever view is showing.
  return (
    <main className="w-full px-4 py-10 sm:px-6">
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
        todayKey={vancouverDayKey(new Date(now))}
      />
    </main>
  );
}
