'use client';

import Link from 'next/link';
import { useViewer } from '@/components/ViewerContext';

/**
 * The "Write a review" affordance on a professor page, resolved in the
 * browser: which courses the viewer shared with this professor is personal
 * state, and reading it server-side kept every professor page dynamic.
 * Until it resolves (and for everyone signed out) the quiet sign-in sentence
 * shows - the same thing crawlers index.
 */
export default function ProfessorReviewCta({
  courses,
}: {
  /** Every course this professor teaches, with its prebuilt review href. */
  courses: { id: string; code: string; reviewHref: string }[];
}) {
  const viewer = useViewer();
  const reviewable = courses.filter((c) => viewer.reviewableCourseIds.has(c.id));

  if (reviewable.length === 1) {
    return (
      <Link
        href={reviewable[0].reviewHref}
        className="rounded-pill bg-brand px-4 py-1.5 text-xs font-medium text-brand-foreground transition duration-150 ease-out hover:scale-[1.02] hover:bg-brand-hover active:scale-100"
      >
        Write a review
      </Link>
    );
  }

  if (reviewable.length > 1) {
    /* A review belongs to a course, so with more than one shared course the
       button cannot decide for you. Native disclosure rather than a menu: it
       is a list of links. */
    return (
      <details className="group">
        <summary className="inline-block cursor-pointer list-none rounded-pill bg-brand px-4 py-1.5 text-xs font-medium text-brand-foreground transition duration-150 ease-out hover:scale-[1.02] hover:bg-brand-hover active:scale-100">
          Write a review
        </summary>
        <div className="mt-2">
          <p className="text-xs text-text-tertiary">Which course?</p>
          <ul className="mt-1 space-y-1">
            {reviewable.map((c) => (
              <li key={c.id}>
                <Link href={c.reviewHref} className="text-xs text-brand-accent hover:underline">
                  {c.code}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </details>
    );
  }

  /* Same quiet sentence the course page uses rather than a dead button - the
     one person who could fix an empty review list should be told how. */
  return (
    <span className="text-xs text-text-tertiary">
      Took a course with them?{' '}
      <Link
        href={viewer.signedIn ? '/onboarding#upload' : '/login'}
        className="text-brand-accent hover:underline"
      >
        {viewer.signedIn ? 'Upload your courses' : 'Log in'}
      </Link>{' '}
      to review.
    </span>
  );
}
