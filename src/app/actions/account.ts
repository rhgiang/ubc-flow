'use server';

import { auth } from '@/lib/auth';
import { db } from '@/lib/db';

type Result = { ok: true } | { ok: false; error: string };

/**
 * Deletes a user and everything tied to them: reviews, saved schedules,
 * enrollment records, verification status, calendar tokens, and vote
 * history. Every table with a foreign key back to User (directly, or via
 * SavedSchedule) has onDelete: Cascade, so db.user.delete alone handles
 * almost all of it in one transaction.
 *
 * The one exception: ReviewVote.reviewId is a raw id, not a real foreign key,
 * because a vote can target either a CourseReview or an InstructorReview.
 * Cascade can't follow that, so another student's vote on THIS user's review
 * would otherwise survive pointing at a review that no longer exists.
 * Cleared explicitly first, inside the same transaction.
 */
export async function deleteAccountFor(userId: string): Promise<Result> {
  await db.$transaction(async (tx) => {
    const [courseReviews, instructorReviews] = await Promise.all([
      tx.courseReview.findMany({ where: { userId }, select: { id: true } }),
      tx.instructorReview.findMany({ where: { userId }, select: { id: true } }),
    ]);
    if (courseReviews.length > 0) {
      await tx.reviewVote.deleteMany({
        where: { kind: 'course', reviewId: { in: courseReviews.map((r) => r.id) } },
      });
    }
    if (instructorReviews.length > 0) {
      await tx.reviewVote.deleteMany({
        where: { kind: 'instructor', reviewId: { in: instructorReviews.map((r) => r.id) } },
      });
    }
    await tx.user.delete({ where: { id: userId } });
  });

  return { ok: true };
}

export async function deleteAccount(): Promise<Result> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: 'Sign in to delete your account.' };
  return deleteAccountFor(userId);
}
