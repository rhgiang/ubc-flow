import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { isUpcomingTerm } from '@/schedule/terms';
import SignOutButton from '@/components/SignOutButton';
import UploadCoursesForm from '@/components/UploadCoursesForm';

function courseHref(subjectCode: string, number: string): string {
  return `/course/${`${subjectCode} ${number}`.toLowerCase().replace(/\s+/g, '-')}`;
}

type CourseRow = { id: string; code: string; title: string; href: string };
type TermGroup = { termId: string; termName: string; rows: CourseRow[] };

function CourseGroup({ group, first }: { group: TermGroup; first: boolean }) {
  return (
    <div className={first ? '' : 'mt-6'}>
      <h3 className="text-sm font-medium text-foreground">{group.termName}</h3>
      <ul className="mt-2 divide-y divide-border rounded-card border border-border">
        {group.rows.map((r) => (
          <li key={r.id} className="px-4 py-2.5 text-sm">
            <Link href={r.href} className="font-medium text-brand hover:underline">
              {r.code}
            </Link>
            <span className="ml-2 text-text-secondary">{r.title}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default async function OnboardingPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');
  const userId = session.user.id;

  const [user, enrollments, terms] = await Promise.all([
    db.user.findUnique({ where: { id: userId }, select: { verifiedAt: true } }),
    db.enrollment.findMany({ where: { userId } }),
    db.term.findMany({ where: { campus: 'V' }, orderBy: [{ year: 'desc' }, { termNumber: 'desc' }] }),
  ]);

  const termById = new Map(terms.map((t) => [t.id, t]));
  const courseIds = [...new Set(enrollments.map((e) => e.courseId))];
  const courses = courseIds.length
    ? await db.course.findMany({ where: { id: { in: courseIds } }, include: { subject: true } })
    : [];
  const courseById = new Map(courses.map((c) => [c.id, c]));

  const currentByTerm = new Map<string, TermGroup>();
  const pastByTerm = new Map<string, TermGroup>();
  for (const e of enrollments) {
    const term = termById.get(e.termId);
    const course = courseById.get(e.courseId);
    if (!term || !course) continue;
    const bucket = isUpcomingTerm(term) ? currentByTerm : pastByTerm;
    const group = bucket.get(e.termId) ?? { termId: e.termId, termName: term.name, rows: [] };
    group.rows.push({
      id: e.id,
      code: `${course.subject.code} ${course.number}`,
      title: course.title,
      href: courseHref(course.subject.code ?? '', course.number),
    });
    bucket.set(e.termId, group);
  }

  const verified = Boolean(user?.verifiedAt);

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-3xl font-semibold text-foreground">Account</h1>
        <SignOutButton />
      </div>

      {verified ? (
        <>
          <div className="mt-6 flex items-center gap-2 rounded-card border border-border bg-surface-muted px-4 py-3">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-5 w-5 shrink-0 text-brand">
              <circle cx="12" cy="12" r="9" />
              <path d="m8 12.5 2.5 2.5L16 9.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <p className="text-sm font-medium text-foreground">UBC Student — Verified</p>
          </div>

          <section className="mt-8">
            <h2 className="text-xl font-semibold text-foreground">Current courses</h2>
            {currentByTerm.size === 0 ? (
              <p className="mt-2 text-sm text-text-secondary">No current courses on record.</p>
            ) : (
              [...currentByTerm.values()].map((g, i) => <CourseGroup key={g.termId} group={g} first={i === 0} />)
            )}
          </section>

          <section className="mt-8">
            <h2 className="text-xl font-semibold text-foreground">Past courses</h2>
            {pastByTerm.size === 0 ? (
              <p className="mt-2 text-sm text-text-secondary">No past courses on record.</p>
            ) : (
              [...pastByTerm.values()].map((g, i) => <CourseGroup key={g.termId} group={g} first={i === 0} />)
            )}
          </section>

          <div className="mt-10 border-t border-border pt-8">
            <UploadCoursesForm verified />
          </div>
        </>
      ) : (
        <div className="mt-6">
          <UploadCoursesForm verified={false} />
        </div>
      )}
    </main>
  );
}
