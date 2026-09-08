'use client';

import Link from 'next/link';
import { useViewer } from '@/components/ViewerContext';

/**
 * "Write a review" / "Edit your review" beside a course's ratings card,
 * resolved in the browser so the page itself can be served statically.
 * The signed-out sentence is the default while the viewer loads.
 */
export default function CourseReviewCta({ code }: { code: string }) {
  const viewer = useViewer();

  if (viewer.mayReview) {
    return (
      <Link
        href={`/course/${code}/review`}
        className="rounded-pill bg-brand px-4 py-1.5 text-xs font-medium text-brand-foreground transition duration-150 ease-out hover:scale-[1.02] hover:bg-brand-hover active:scale-100"
      >
        {viewer.hasMyReview ? 'Edit your review' : 'Write a review'}
      </Link>
    );
  }

  /* The gate used to fail silently - the one student who could fix the empty
     review list saw nothing at all. One quiet sentence, not a banner. */
  return (
    <span className="text-xs text-text-tertiary">
      Took this course?{' '}
      <Link
        href={viewer.signedIn ? '/onboarding#upload' : '/login'}
        className="text-brand-accent hover:underline"
      >
        {viewer.signedIn ? 'Verify your enrolment' : 'Sign in'}
      </Link>{' '}
      to review it.
    </span>
  );
}
