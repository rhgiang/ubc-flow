'use server';

import { auth } from '@/lib/auth';
import { db } from '@/lib/db';

export type VoteKind = 'course' | 'instructor';

export type VoteResult =
  | { ok: true; voted: boolean; votes: number }
  | { ok: false; error: string };

/**
 * Toggle "this review was helpful" for one user on one review.
 *
 * Session-free half, so it can be tested without a request: the wrapper below
 * supplies the user. Follows the same split as getOrCreateTokenFor.
 */
export async function toggleReviewVoteFor(
  userId: string,
  reviewId: string,
  kind: VoteKind,
): Promise<VoteResult> {
  // A vote on a review that does not exist would otherwise sit in the table
  // forever, counted against nothing.
  const exists =
    kind === 'course'
      ? await db.courseReview.findUnique({ where: { id: reviewId }, select: { id: true } })
      : await db.instructorReview.findUnique({ where: { id: reviewId }, select: { id: true } });
  if (!exists) return { ok: false, error: 'That review no longer exists.' };

  const existing = await db.reviewVote.findUnique({
    where: { userId_reviewId: { userId, reviewId } },
  });

  if (existing) {
    await db.reviewVote.delete({ where: { id: existing.id } });
  } else {
    await db.reviewVote.create({ data: { userId, reviewId, kind } });
  }

  const votes = await db.reviewVote.count({ where: { reviewId } });
  return { ok: true, voted: !existing, votes };
}

export async function toggleReviewVote(reviewId: string, kind: VoteKind): Promise<VoteResult> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: 'Sign in to mark a review helpful.' };
  return toggleReviewVoteFor(userId, reviewId, kind);
}
