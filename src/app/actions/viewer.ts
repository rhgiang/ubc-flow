'use server';

import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { voteSummary } from '@/reviews/votes';
import { canReview, reviewableCourses } from '@/lib/gate';

export type ViewerState = {
  signedIn: boolean;
  votedReviewIds: string[];
  reviewableCourseIds: string[];
  mayReview: boolean;
  hasMyReview: boolean;
  mySchedules: { id: string; name: string; termId: string }[];
};

const ANONYMOUS: ViewerState = {
  signedIn: false,
  votedReviewIds: [],
  reviewableCourseIds: [],
  mayReview: false,
  hasMyReview: false,
  mySchedules: [],
};

/**
 * Everything about the VIEWER that a course or professor page shows — their
 * votes, whether they can review, their schedules for the add-to dropdown.
 *
 * Split out of those pages' server renders so the pages themselves can be
 * served statically: the catalogue half is identical for everyone and cached,
 * and this personal half is fetched from the browser after load. Anonymous
 * visitors and crawlers (most of the traffic) never trigger it at all.
 */
export async function getViewerState(input: {
  reviewIds?: string[];
  courseId?: string;
  wantSchedules?: boolean;
}): Promise<ViewerState> {
  const session = await auth();
  const userId = session?.user?.id ?? null;
  if (!userId) return ANONYMOUS;

  // Belt-and-braces bound: a page never has anywhere near this many reviews.
  const reviewIds = (input.reviewIds ?? []).slice(0, 1000);

  const [votes, reviewable, mayReview, myReview, mySchedules] = await Promise.all([
    reviewIds.length
      ? voteSummary(reviewIds, userId)
      : { mine: new Set<string>() },
    reviewableCourses(userId),
    input.courseId ? canReview(userId, input.courseId) : false,
    input.courseId
      ? db.courseReview.findUnique({
          where: { userId_courseId: { userId, courseId: input.courseId } },
          select: { id: true },
        })
      : null,
    input.wantSchedules
      ? db.savedSchedule.findMany({
          where: { userId },
          select: { id: true, name: true, termId: true },
        })
      : [],
  ]);

  return {
    signedIn: true,
    votedReviewIds: [...votes.mine],
    reviewableCourseIds: reviewable,
    mayReview,
    hasMyReview: myReview !== null,
    mySchedules,
  };
}
