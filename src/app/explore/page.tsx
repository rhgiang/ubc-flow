import Link from 'next/link';
import { db } from '@/lib/db';
import { listCourses, listProfessors, PAGE_SIZE, type CourseSort, type ProfessorSort } from '@/lib/explore';
import { unstable_cache } from 'next/cache';
import { isUpcomingTerm, compareTerms } from '@/schedule/terms';
import ExploreSubjectSelect from '@/components/ExploreSubjectSelect';
import ExploreSearchInput from '@/components/ExploreSearchInput';

type Tab = 'courses' | 'professors';

type SP = {
  tab?: string;
  q?: string;
  subject?: string;
  level?: string; // comma-separated: "1,2,3"
  term?: string; // "this" | "next"
  requirements?: string; // "none" | "has"
  faculty?: string; // Subject.faculty, e.g. "Faculty of Science"
  sort?: string;
  page?: string;
};

/** Builds an href for the current page with one or more params overridden —
 * every filter/sort control is a plain link, no client JS needed. */
function hrefWith(sp: SP, overrides: Partial<Record<keyof SP, string | null>>): string {
  const merged: Record<string, string | null | undefined> = { ...sp, ...overrides };
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(merged)) {
    if (value) params.set(key, String(value));
  }
  // Any filter/sort change resets pagination — staying on page 4 of a
  // narrower result set would silently show nothing.
  if (!('page' in overrides)) params.delete('page');
  const qs = params.toString();
  return qs ? `/explore?${qs}` : '/explore';
}

const LEVELS = [1, 2, 3, 4, 5] as const;

/**
 * Degree label -> Subject.faculty, as the Calendar writes it.
 *
 * A course is not itself a BA or a BSc — degrees are programs. What people
 * mean by "BSc courses" is courses whose subject belongs to Science, so the
 * filter is by faculty and the label names the degree that faculty grants.
 * Only the faculties with a well-known undergraduate degree are listed;
 * filtering by School of Audiology helps nobody.
 *
 * Nursing and Kinesiology are deliberately absent. UBC nests those schools
 * inside a parent faculty, and the Calendar files their subjects there —
 * NURS courses come back under Applied Science. Offering "BSN · Nursing" as
 * its own row would return nothing, which is worse than not offering it.
 */
const DEGREE_FACULTIES: [string, string][] = [
  ['BA · Arts', 'Faculty of Arts'],
  ['BSc · Science', 'Faculty of Science'],
  ['BASc · Applied Science', 'Faculty of Applied Science'],
  ['BCom · Commerce', 'Faculty of Commerce and Business Administration'],
];

/**
 * Nothing on this page is visitor-specific, but `searchParams` makes the
 * route itself dynamic - so the caching lives at the data layer instead.
 * Each distinct filter combination is its own cache entry (arguments are part
 * of unstable_cache's key). Tagged 'catalogue' like the course and professor
 * pages, so review writes refresh the ratings columns here too.
 */
const cachedListCourses = unstable_cache(listCourses, ['explore-courses'], {
  revalidate: 86400,
  tags: ['catalogue'],
});
const cachedListProfessors = unstable_cache(listProfessors, ['explore-professors'], {
  revalidate: 86400,
  tags: ['catalogue'],
});
const getExploreHeader = unstable_cache(
  async () =>
    Promise.all([
      db.term.findMany({ where: { campus: 'V' } }),
      db.subject.findMany({ where: { campus: 'V', code: { not: null } }, orderBy: { code: 'asc' } }),
      db.course.count({ where: { campus: 'V' } }),
      db.instructor.count({ where: { campus: 'V' } }),
    ]),
  ['explore-header'],
  { revalidate: 86400, tags: ['catalogue'] },
);

export default async function ExplorePage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const tab: Tab = sp.tab === 'professors' ? 'professors' : 'courses';
  const q = sp.q?.trim() ?? '';
  const levels = (sp.level ?? '')
    .split(',')
    .map(Number)
    .filter((n) => LEVELS.includes(n as (typeof LEVELS)[number]));
  const requirements = sp.requirements === 'none' || sp.requirements === 'has' ? sp.requirements : undefined;
  const page = Math.max(1, Number(sp.page) || 1);
  // Matched against the list we offer, so the query only ever sees a faculty
  // we chose to expose — same treatment termId gets.
  const faculty = DEGREE_FACULTIES.some(([, f]) => f === sp.faculty) ? sp.faculty : undefined;

  const [terms, subjects, courseTotal, professorTotal] = await getExploreHeader();
  // Every term from the current one onward, not just this/next — a student
  // browsing in the summer is usually planning both Winter terms, and the
  // two-chip version could never show Winter Term 2.
  // Professors accept several subjects at once (comma-separated); courses
  // still filter by a single subject and just take the first.
  const subjectList = (sp.subject ?? '').split(',').filter(Boolean);
  const offeredTerms = terms.filter(isUpcomingTerm).sort(compareTerms);
  // Matched against the real list rather than trusted, so the query only ever
  // sees an id we chose to offer.
  const termId = offeredTerms.some((t) => t.id === sp.term) ? sp.term : undefined;

  const courseResult =
    tab === 'courses'
      ? await cachedListCourses({
          q,
          subject: subjectList[0],
          faculty,
          levels,
          termId,
          requirements,
          sort: sp.sort as CourseSort | undefined,
          page,
        })
      : null;
  const professorResult =
    tab === 'professors'
      ? await cachedListProfessors({ q, teachesSubjects: subjectList, sort: sp.sort as ProfessorSort | undefined, page })
      : null;

  const total = tab === 'courses' ? courseResult!.total : professorResult!.total;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const hasFilters = Boolean(q || sp.subject || levels.length || sp.term || requirements || faculty);

  const SORT_HEADERS: { key: CourseSort | ProfessorSort; label: string }[] =
    tab === 'courses'
      ? [
          { key: 'code', label: 'Course code' },
          { key: 'name', label: 'Course name' },
          { key: 'ratings', label: 'Ratings' },
          { key: 'useful', label: 'Useful' },
          { key: 'difficulty', label: 'Easy' },
          { key: 'liked', label: 'Liked' },
        ]
      : [
          { key: 'name', label: 'Professor name' },
          { key: 'ratings', label: 'Ratings' },
          { key: 'clear', label: 'Clear' },
          { key: 'engaging', label: 'Engaging' },
          { key: 'liked', label: 'Liked' },
        ];

  // Rendered twice — inside the desktop sidebar and the mobile disclosure —
  // so the two stay one control set rather than drifting apart.
  const filterControls = (
    <>
      {tab === 'courses' ? (
        <>
          <p className="mt-4 text-xs font-medium text-text-secondary">Course level</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {LEVELS.map((lvl) => {
              const active = levels.includes(lvl);
              const nextLevels = active ? levels.filter((l) => l !== lvl) : [...levels, lvl];
              return (
                <Link
                  key={lvl}
                  href={hrefWith(sp, { level: nextLevels.join(',') || null })}
                  className={`rounded-pill border px-3.5 py-2 max-sm:inline-flex max-sm:min-h-11 max-sm:items-center text-sm font-medium ${
                    active
                      ? 'border-brand bg-brand text-brand-foreground'
                      : 'border-border text-foreground hover:bg-surface-muted'
                  }`}
                >
                  {lvl >= 5 ? '5XX+' : `${lvl}XX`}
                </Link>
              );
            })}
          </div>

          <p className="mt-5 text-xs font-medium text-text-secondary">Offered in</p>
          <div className="mt-2 flex flex-col gap-1.5">
            {offeredTerms.map((t) => (
              <Link
                key={t.id}
                href={hrefWith(sp, { term: sp.term === t.id ? null : t.id })}
                className={`rounded-pill border px-3.5 py-2 max-sm:inline-flex max-sm:min-h-11 max-sm:items-center text-left text-sm font-medium ${
                  sp.term === t.id
                    ? 'border-brand bg-brand text-brand-foreground'
                    : 'border-border text-foreground hover:bg-surface-muted'
                }`}
              >
                {t.name.replace(' (UBC-V)', '')}
              </Link>
            ))}
          </div>

          <p className="mt-5 text-xs font-medium text-text-secondary">Degree</p>
          <div className="mt-2 flex flex-col gap-1.5">
            {DEGREE_FACULTIES.map(([label, f]) => (
              <Link
                key={f}
                href={hrefWith(sp, { faculty: faculty === f ? null : f })}
                className={`rounded-pill border px-3.5 py-2 max-sm:inline-flex max-sm:min-h-11 max-sm:items-center text-left text-sm font-medium ${
                  faculty === f
                    ? 'border-brand bg-brand text-brand-foreground'
                    : 'border-border text-foreground hover:bg-surface-muted'
                }`}
              >
                {label}
              </Link>
            ))}
          </div>

          <p className="mt-5 text-xs font-medium text-text-secondary">Requirements</p>
          <div className="mt-2 flex flex-col gap-1.5">
            <Link
              href={hrefWith(sp, { requirements: requirements === 'none' ? null : 'none' })}
              className={`rounded-pill border px-3.5 py-2 max-sm:inline-flex max-sm:min-h-11 max-sm:items-center text-left text-sm font-medium ${
                requirements === 'none'
                  ? 'border-brand bg-brand text-brand-foreground'
                  : 'border-border text-foreground hover:bg-surface-muted'
              }`}
            >
              No prerequisites
            </Link>
            <Link
              href={hrefWith(sp, { requirements: requirements === 'has' ? null : 'has' })}
              className={`rounded-pill border px-3.5 py-2 max-sm:inline-flex max-sm:min-h-11 max-sm:items-center text-left text-sm font-medium ${
                requirements === 'has'
                  ? 'border-brand bg-brand text-brand-foreground'
                  : 'border-border text-foreground hover:bg-surface-muted'
              }`}
            >
              Has prerequisites
            </Link>
          </div>
        </>
      ) : (
        <>
          <p className="mt-4 text-xs font-medium text-text-secondary">Teaches</p>
          {subjectList.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {subjectList.map((code) => (
                <Link
                  key={code}
                  href={hrefWith(sp, {
                    subject: subjectList.filter((c) => c !== code).join(',') || null,
                  })}
                  aria-label={`Remove ${code} filter`}
                  className="flex items-center gap-1.5 rounded-pill border border-brand bg-brand px-3.5 py-2 text-sm font-medium text-brand-foreground hover:bg-brand-hover"
                >
                  {code}
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="h-3 w-3">
                    <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
                  </svg>
                </Link>
              ))}
            </div>
          )}
          <ExploreSubjectSelect subjects={subjects} value={sp.subject ?? ''} multi />
        </>
      )}

      {hasFilters && (
        <Link
          href="/explore"
          className="mt-6 flex items-center justify-center gap-1.5 rounded-pill bg-brand px-4 py-2.5 text-sm font-medium text-brand-foreground hover:bg-brand-hover"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-3 w-3">
            <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
          </svg>
          Clear filter
        </Link>
      )}
    </>
  );

  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-10">
      <h1 className="sky-hero text-3xl font-semibold">Explore</h1>

      <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_300px]">
        {/* min-w-0: without it the 1fr column refuses to shrink below its
            widest child's min-content and the whole page scrolls sideways
            on phones. */}
        <div className="min-w-0">
          <div className="sky-panel flex overflow-hidden">
            <Link
              href={hrefWith(sp, { tab: null })}
              className={`flex-1 px-4 py-3.5 text-center text-sm font-semibold ${
                tab === 'courses' ? 'bg-surface text-foreground' : 'bg-surface-muted text-text-secondary'
              }`}
            >
              Courses ({courseTotal})
            </Link>
            <Link
              href={hrefWith(sp, { tab: 'professors' })}
              className={`flex-1 px-4 py-3.5 text-center text-sm font-semibold ${
                tab === 'professors' ? 'bg-surface text-foreground' : 'bg-surface-muted text-text-secondary'
              }`}
            >
              Professors ({professorTotal})
            </Link>
          </div>

          <div className="mt-4">
            <ExploreSearchInput />
          </div>

          {/* The tab labels carry campus-wide totals, so a filtered view needs
              its own count — without this a filter looks like a no-op. */}
          {hasFilters && (
            <p className="sky-hero mt-4 text-sm" aria-live="polite">
              {total.toLocaleString('en-CA')} {tab === 'courses' ? 'courses' : 'professors'} match your
              filters
            </p>
          )}

          {/* On phones the sidebar would land below the table and pagination,
              a full page from what it controls — surface the same controls
              here as a native disclosure instead. */}
          <details className="sky-panel mt-4 lg:hidden">
            <summary className="cursor-pointer list-none px-5 py-3 text-sm font-semibold text-foreground">
              Filters{hasFilters && <span className="ml-2 font-normal text-brand-accent">· active</span>}
            </summary>
            <div className="px-5 pb-5">{filterControls}</div>
          </details>

          <div className="mt-4 flex gap-1.5 overflow-x-auto sm:hidden" aria-label="Sort by">
            {SORT_HEADERS.map((h) => (
              <Link
                key={h.key}
                href={hrefWith(sp, { sort: h.key })}
                // capsule-chip: dark backing so the chips survive pale
                // gray-weather skies the way the nav and footer links do;
                // plain themes strip it back to ordinary text via CSS.
                className="capsule-chip whitespace-nowrap rounded-pill border border-border max-sm:inline-flex max-sm:min-h-11 max-sm:items-center px-3.5 py-2 text-sm font-medium"
              >
                {h.label}
              </Link>
            ))}
          </div>

          <div className="sky-panel mt-4 overflow-x-auto">
            <table className="sky-table hidden w-full text-left text-sm sm:table">
              <thead className="border-b border-border text-xs text-text-secondary">
                <tr>
                  {SORT_HEADERS.map((h) => (
                    <th key={h.key} className="whitespace-nowrap px-4 py-3 font-medium">
                      <Link href={hrefWith(sp, { sort: h.key })} className="hover:text-foreground">
                        {h.label}
                      </Link>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tab === 'courses'
                  ? courseResult!.rows.map((r) => (
                      <tr key={r.code} className="border-b border-border last:border-0">
                        <td className="whitespace-nowrap px-4 py-3">
                          <Link
                            href={`/course/${r.code.toLowerCase().replace(' ', '-')}`}
                            className="font-medium text-brand-accent hover:underline"
                          >
                            {r.code}
                          </Link>
                        </td>
                        <td className="px-4 py-3 text-foreground">{r.title}</td>
                        <td className="px-4 py-3 text-text-secondary">{r.reviewCount}</td>
                        <td className="px-4 py-3 text-text-secondary">
                          {r.useful !== null ? `${r.useful.toFixed(1)}/5` : '—'}
                        </td>
                        <td className="px-4 py-3 text-text-secondary">
                          {r.difficulty !== null ? `${r.difficulty.toFixed(1)}/5` : '—'}
                        </td>
                        <td className="px-4 py-3 text-text-secondary">
                          {r.likedPercent !== null ? `${r.likedPercent}%` : '—'}
                        </td>
                      </tr>
                    ))
                  : professorResult!.rows.map((r) => (
                      <tr key={r.slug} className="border-b border-border last:border-0">
                        <td className="px-4 py-3">
                          <Link href={`/professor/${r.slug}`} className="font-medium text-brand-accent hover:underline">
                            {r.name}
                          </Link>
                        </td>
                        <td className="px-4 py-3 text-text-secondary">{r.reviewCount}</td>
                        <td className="px-4 py-3 text-text-secondary">
                          {r.clear !== null ? `${r.clear.toFixed(1)}/5` : '—'}
                        </td>
                        <td className="px-4 py-3 text-text-secondary">
                          {r.engaging !== null ? `${r.engaging.toFixed(1)}/5` : '—'}
                        </td>
                        <td className="px-4 py-3 text-text-secondary">
                          {r.likedPercent !== null ? `${r.likedPercent}%` : '—'}
                        </td>
                      </tr>
                    ))}
              </tbody>
            </table>

            {/* Card-per-row on phones — same rows, same data, no six-column crush. */}
            <div className="divide-y divide-border sm:hidden">
              {tab === 'courses'
                ? courseResult!.rows.map((r) => (
                    <div key={r.code} className="px-4 py-3">
                      <Link
                        href={`/course/${r.code.toLowerCase().replace(' ', '-')}`}
                        className="font-medium text-brand-accent hover:underline"
                      >
                        {r.code}
                      </Link>
                      <p className="mt-0.5 text-sm text-foreground">{r.title}</p>
                      <p className="mt-1.5 text-xs tabular-nums text-text-tertiary">
                        {r.reviewCount} {r.reviewCount === 1 ? 'review' : 'reviews'}
                        {r.useful !== null && ` · Useful ${r.useful.toFixed(1)}/5`}
                        {r.difficulty !== null && ` · Easy ${r.difficulty.toFixed(1)}/5`}
                        {r.likedPercent !== null && ` · ${r.likedPercent}% liked`}
                      </p>
                    </div>
                  ))
                : professorResult!.rows.map((r) => (
                    <div key={r.slug} className="px-4 py-3">
                      <Link
                        href={`/professor/${r.slug}`}
                        className="font-medium text-brand-accent hover:underline"
                      >
                        {r.name}
                      </Link>
                      <p className="mt-1.5 text-xs tabular-nums text-text-tertiary">
                        {r.reviewCount} {r.reviewCount === 1 ? 'review' : 'reviews'}
                        {r.clear !== null && ` · Clear ${r.clear.toFixed(1)}/5`}
                        {r.engaging !== null && ` · Engaging ${r.engaging.toFixed(1)}/5`}
                        {r.likedPercent !== null && ` · ${r.likedPercent}% liked`}
                      </p>
                    </div>
                  ))}
            </div>

            {total === 0 && (
              <p className="p-6 text-center text-sm text-text-secondary">
                No {tab === 'courses' ? 'courses' : 'professors'} match these filters.
              </p>
            )}
          </div>

          {totalPages > 1 && (
            <div className="mt-4 flex items-center justify-between text-sm">
              <Link
                href={hrefWith(sp, { page: String(page - 1) })}
                aria-disabled={page <= 1}
                className={`rounded-pill border border-border px-5 py-2.5 ${
                  page <= 1 ? 'pointer-events-none opacity-60' : 'hover:bg-surface-muted'
                }`}
              >
                Previous
              </Link>
              <span className="text-text-secondary">
                Page {page} of {totalPages}
              </span>
              <Link
                href={hrefWith(sp, { page: String(page + 1) })}
                aria-disabled={page >= totalPages}
                className={`rounded-pill border border-border px-5 py-2.5 ${
                  page >= totalPages ? 'pointer-events-none opacity-60' : 'hover:bg-surface-muted'
                }`}
              >
                Next
              </Link>
            </div>
          )}
        </div>

        <aside className="sky-panel hidden h-fit p-5 lg:block">
          <p className="text-sm font-semibold text-foreground">Filter your results</p>
          {filterControls}
        </aside>
      </div>
    </main>
  );
}
