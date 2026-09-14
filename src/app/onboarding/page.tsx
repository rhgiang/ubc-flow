import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { isUpcomingTerm } from "@/schedule/terms";
import SignOutButton from "@/components/SignOutButton";
import UploadCoursesForm from "@/components/UploadCoursesForm";
import DeleteAccountButton from "@/components/DeleteAccountButton";
import EnrolledCourseCard from "@/components/EnrolledCourseCard";

function courseHref(subjectCode: string, number: string): string {
  return `/course/${`${subjectCode} ${number}`.toLowerCase().replace(/\s+/g, "-")}`;
}

/** "10:00" -> "10:00 AM", "15:30" -> "3:30 PM". */
function formatTime(t: string): string {
  const [h, m] = t.split(":").map(Number);
  const period = h < 12 ? "AM" : "PM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${period}`;
}

const MONTH_DAY = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
});

/** Sep 8, 2026 – Dec 7, 2026 -> "Sep 8 – Dec 7, 2026" (year shown once, off the end date). */
function formatDateRange(start: Date, end: Date): string {
  return `${MONTH_DAY.format(start)} – ${MONTH_DAY.format(end)}, ${end.getFullYear()}`;
}

type MeetingLite = {
  id: string;
  activity: string | null;
  days: string[];
  startTime: string | null;
  endTime: string | null;
  building: string | null;
  room: string | null;
  instructor: string | null;
  startDate: Date | null;
  endDate: Date | null;
};

type CourseRow = {
  id: string;
  courseId: string;
  termId: string | null;
  code: string;
  title: string;
  href: string;
  meetings: MeetingLite[];
};
type TermGroup = { termId: string; termName: string; rows: CourseRow[] };

function MeetingLine({ m }: { m: MeetingLite }) {
  const location = m.building
    ? `${m.building}${m.room ? ` ${m.room}` : ""}`
    : null;
  const time =
    m.startTime && m.endTime
      ? `${formatTime(m.startTime)} – ${formatTime(m.endTime)}`
      : null;
  const dateRange =
    m.startDate && m.endDate ? formatDateRange(m.startDate, m.endDate) : null;

  return (
    <div className="text-xs">
      <p className="font-medium text-foreground">
        {m.activity ?? "Class"}
        {m.instructor && (
          <span className="font-normal text-text-secondary">
            {" "}
            · {m.instructor}
          </span>
        )}
      </p>
      <p className="mt-0.5 text-text-secondary">
        {[m.days.length > 0 ? m.days.join(" ") : null, time, location]
          .filter(Boolean)
          .join(" · ") || "No fixed meeting time"}
      </p>
      {dateRange && <p className="mt-0.5 text-text-tertiary">{dateRange}</p>}
    </div>
  );
}

function CourseCard({ course, canRemove }: { course: CourseRow; canRemove: boolean }) {
  return (
    <EnrolledCourseCard
      code={course.code}
      title={course.title}
      href={course.href}
      courseId={course.courseId}
      termId={course.termId}
      canRemove={canRemove}
      collapsible={course.meetings.length > 0}
    >
      {course.meetings.map((m) => (
        <MeetingLine key={m.id} m={m} />
      ))}
    </EnrolledCourseCard>
  );
}

/**
 * `canRemove` is false for finished terms and for the undated academic record.
 * Removing is for a schedule change or a drop, and neither is a thing you can
 * do to a course you already completed: the only effect there would be to
 * quietly change degree progress and review eligibility with no way back
 * except re-importing the record.
 */
function CourseGroup({
  group,
  first,
  canRemove,
}: {
  group: TermGroup;
  first: boolean;
  canRemove: boolean;
}) {
  return (
    <div className={first ? "" : "mt-5"}>
      <h3 className="text-sm font-medium text-foreground">{group.termName}</h3>
      {/* A single column rather than a grid: collapsed cards are one-liners,
          so a list stays compact, and expanding one simply pushes the rest
          down. In two columns an expanded card leaves dead space beside it,
          because a grid row is as tall as its tallest cell. */}
      <div className="mt-2 flex flex-col gap-2">
        {group.rows.map((r) => (
          <CourseCard key={r.id} course={r} canRemove={canRemove} />
        ))}
      </div>
    </div>
  );
}

export default async function OnboardingPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const userId = session.user.id;

  const [user, enrollments, myReviews, meetings, terms, transferCredits] =
    await Promise.all([
      db.user.findUnique({
        where: { id: userId },
        select: { verifiedAt: true },
      }),
      db.enrollment.findMany({ where: { userId } }),
      db.courseReview.findMany({ where: { userId }, select: { courseId: true } }),
      db.enrollmentMeeting.findMany({ where: { userId } }),
      db.term.findMany({
        where: { campus: "V" },
        orderBy: [{ year: "desc" }, { termNumber: "desc" }],
      }),
      // Transfer credit is not an enrolment - it has no UBC term and often no
      // UBC course - so it appears in neither of the lists above. Uploading an
      // academic record stored ten rows and showed the student nothing.
      db.transferCredit.findMany({
        where: { userId },
        orderBy: { raw: "asc" },
        select: {
          id: true,
          raw: true,
          credits: true,
          course: {
            select: {
              number: true,
              title: true,
              credits: true,
              subject: { select: { code: true } },
            },
          },
        },
      }),
    ]);

  /**
   * Whether this account's courses predate the grade columns.
   *
   * An import from before them recorded registration only, so every row reads
   * "registered" and degree progress counts none of it. That is the safe
   * direction - the alternative is telling someone they passed a course they
   * failed - but it leaves the guidance panel looking inert on an account
   * that has clearly uploaded something, with no hint that a re-upload is
   * what fixes it.
   */
  // Judged on FINISHED terms only, and on enrolments alone.
  //
  // A course still running has no grade yet, so "registered" is correct for it
  // and says nothing about the import. A finished one should carry a grade
  // after any upload made since the grade columns existed; if none of them
  // does, the record predates that.
  //
  // The first version also required the account to have no transfer credit, on
  // the theory that any meant a recent re-upload. It does not: transfer credit
  // comes from the academic-record export and courses from the current-term
  // one, so uploading the record hid the prompt for the courses.
  const finishedTermIds = new Set(
    terms.filter((t) => !isUpcomingTerm(t)).map((t) => t.id),
  );
  const finishedEnrollments = enrollments.filter(
    (e) => e.termId !== null && finishedTermIds.has(e.termId),
  );
  const staleImport =
    finishedEnrollments.length > 0 &&
    finishedEnrollments.every((e) => e.status === "registered");

  const termById = new Map(terms.map((t) => [t.id, t]));
  const courseIds = [...new Set(enrollments.map((e) => e.courseId))];
  const courses = courseIds.length
    ? await db.course.findMany({
        where: { id: { in: courseIds } },
        include: { subject: true },
      })
    : [];
  const courseById = new Map(courses.map((c) => [c.id, c]));

  const meetingsByKey = new Map<string, MeetingLite[]>();
  for (const m of meetings) {
    const key = `${m.courseId}:${m.termId}`;
    const list = meetingsByKey.get(key) ?? [];
    list.push(m);
    meetingsByKey.set(key, list);
  }

  // The funnel: verified, non-transfer courses this student has not reviewed
  // yet. Same predicate as the review gate (src/lib/gate.ts), computed from
  // rows already in hand. The upload form lives on this page and refreshes it,
  // so finishing an upload makes these chips appear immediately - which is
  // the moment someone is most willing to write the review.
  const reviewedIds = new Set(myReviews.map((r) => r.courseId));
  const reviewable = [
    ...new Map(
      enrollments
        .filter((e) => e.verified && e.status !== 'transfer' && !reviewedIds.has(e.courseId))
        .map((e) => [e.courseId, e] as const),
    ).keys(),
  ]
    .map((id) => courseById.get(id))
    .filter((c) => c !== undefined)
    .map((c) => ({
      code: `${c.subject.code} ${c.number}`,
      href: `/course/${(c.subject.code ?? '').toLowerCase()}-${c.number.toLowerCase()}/review`,
    }))
    .sort((a, b) => a.code.localeCompare(b.code));

  const currentByTerm = new Map<string, TermGroup>();
  const pastByTerm = new Map<string, TermGroup>();
  // The academic record dates nothing, so its courses cannot join a term
  // group. They get one of their own rather than being dropped - the whole
  // point of importing them is that they are courses you took.
  const undated: TermGroup = { termId: "undated", termName: "Completed courses", rows: [] };
  for (const e of enrollments) {
    const course = courseById.get(e.courseId);
    if (!course) continue;
    const row = {
      id: e.id,
      courseId: e.courseId,
      termId: e.termId,
      code: `${course.subject.code} ${course.number}`,
      title: course.title,
      href: courseHref(course.subject.code ?? "", course.number),
      meetings:
        e.termId === null ? [] : (meetingsByKey.get(`${e.courseId}:${e.termId}`) ?? []),
    };

    if (e.termId === null) {
      undated.rows.push(row);
      continue;
    }

    const term = termById.get(e.termId);
    if (!term) continue;
    const bucket = isUpcomingTerm(term) ? currentByTerm : pastByTerm;
    const group = bucket.get(e.termId) ?? {
      termId: e.termId,
      termName: term.name,
      rows: [],
    };
    group.rows.push(row);
    bucket.set(e.termId, group);
  }
  // Alphabetical: with no dates there is no other meaningful order.
  undated.rows.sort((a, b) => a.code.localeCompare(b.code));
  if (undated.rows.length > 0) pastByTerm.set("undated", undated);

  const verified = Boolean(user?.verifiedAt);

  return (
    <main className="mx-auto w-full max-w-4xl px-6 py-10">
      <div className="sky-hero flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold sm:text-3xl text-foreground">Account</h1>
        <SignOutButton />
      </div>

      {/* Everything below the title sits on one solid panel - this page is
          mostly small secondary text, which the sky behind it washes out. */}
      <div className="sky-panel mt-6 p-6 sm:p-8">
        {verified ? (
          <>
            <div className="flex items-center gap-2 rounded-card border border-border bg-surface-muted px-4 py-3">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                className="h-5 w-5 shrink-0 text-brand-accent"
              >
                <circle cx="12" cy="12" r="9" />
                <path
                  d="m8 12.5 2.5 2.5L16 9.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <p className="text-sm font-medium text-foreground">
                UBC Student, verified
              </p>
            </div>

            {reviewable.length > 0 && (
              <section className="mt-6 rounded-card border border-border bg-surface-muted p-4">
                <h2 className="text-base font-semibold text-foreground">
                  Review your courses
                </h2>
                <p className="mt-1 text-sm text-text-secondary">
                  You can review {reviewable.length === 1 ? 'this course' : `these ${reviewable.length} courses`}{' '}
                  because your record shows you took {reviewable.length === 1 ? 'it' : 'them'}. Reviews are
                  anonymous, and each one helps the next student pick.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {reviewable.map((c) => (
                    <Link
                      key={c.code}
                      href={c.href}
                      className="rounded-pill border border-border bg-background px-3 py-1.5 text-sm font-medium text-brand-accent transition duration-150 ease-out hover:scale-[1.02] hover:border-brand-accent active:scale-100"
                    >
                      {c.code}
                    </Link>
                  ))}
                </div>
              </section>
            )}

            <section className="mt-6">
              <h2 className="text-xl font-semibold text-foreground">
                Current courses
              </h2>
              {currentByTerm.size === 0 ? (
                <p className="mt-2 text-sm text-text-secondary">
                  No current courses on record.
                </p>
              ) : (
                [...currentByTerm.values()].map((g, i) => (
                  <CourseGroup key={g.termId} group={g} first={i === 0} canRemove />
                ))
              )}
            </section>

            <section className="mt-6">
              <h2 className="text-xl font-semibold text-foreground">
                Past courses
              </h2>
              {pastByTerm.size === 0 ? (
                <p className="mt-2 text-sm text-text-secondary">
                  No past courses on record.
                </p>
              ) : (
                [...pastByTerm.values()].map((g, i) => (
                  <CourseGroup key={g.termId} group={g} first={i === 0} canRemove={false} />
                ))
              )}
            </section>

            {transferCredits.length > 0 && (
              <section className="mt-6">
                <h2 className="text-xl font-semibold text-foreground">
                  Transfer credit
                </h2>
                <p className="mt-1 text-sm text-text-secondary">
                  Earned at another institution. It counts toward your degree in{" "}
                  <Link href="/guidance" className="underline">
                    Guidance
                  </Link>
                  , but doesn&apos;t unlock UBC reviews for these courses.
                </p>
                <ul className="mt-3 space-y-1.5">
                  {transferCredits.map((t) => (
                    <li
                      key={t.id}
                      className="flex flex-wrap items-baseline gap-x-2 rounded-card border border-border px-3 py-2 text-sm"
                    >
                      {t.course ? (
                        <>
                          <span className="font-medium text-foreground">
                            {t.course.subject.code} {t.course.number}
                          </span>
                          <span className="text-text-secondary">
                            {t.course.title}
                          </span>
                        </>
                      ) : (
                        // Unassigned credit - "PHYS_V 1ST" is first-year credit
                        // in a subject rather than a course, so there is no
                        // title to show and nothing to link to.
                        <span className="font-medium text-foreground">
                          {t.raw}
                        </span>
                      )}
                      {/*
                        Falls back on zero as well as null. Workday left
                        APSC 160's Credits cell empty and it rendered as
                        "0 credits" - but a transfer row exists because credit
                        was granted, so an empty cell is missing data rather
                        than a grant of nothing. Same reasoning as the guidance
                        total, which would otherwise disagree with this list.
                      */}
                      {t.credits || t.course?.credits ? (
                        <span className="ml-auto text-xs text-text-tertiary">
                          {t.credits || t.course?.credits} credits
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <div className="mt-8 border-t border-border pt-6">
              {staleImport && (
                <p className="mb-4 rounded-card border border-info-border bg-info-surface px-3 py-2.5 text-sm text-info">
                  <strong className="font-semibold">
                    Re-upload to track your degree.
                  </strong>{" "}
                  Your courses were imported before grades were recorded, so we
                  know what you registered in but not how it went, and{" "}
                  <Link href="/guidance" className="underline">
                    Guidance
                  </Link>{" "}
                  counts none of it toward your requirements. Uploading the same
                  export again fills that in, and picks up any transfer credit,
                  which used to be discarded.
                </p>
              )}
              <UploadCoursesForm verified />
            </div>
          </>
        ) : (
          <div>
            <UploadCoursesForm verified={false} />
          </div>
        )}

        <div className="mt-8 border-t border-border pt-6">
          <h2 className="text-sm font-semibold text-foreground">
            Delete your account and data
          </h2>
          <p className="mt-1 text-sm text-text-secondary">
            This removes everything tied to your account: reviews, saved
            schedules, and enrollment records.
          </p>
          <div className="mt-3">
            <DeleteAccountButton />
          </div>
        </div>
      </div>
    </main>
  );
}
