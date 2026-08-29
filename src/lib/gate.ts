import { db } from '@/lib/db';

/**
 * The review gate: a user may only review a course they have a VERIFIED
 * enrollment in. Phase 3 must call this before accepting any review.
 *
 * Transfer credit is excluded twice over. Import never marks those rows
 * verified, and the status check below says so outright rather than resting
 * on that — the course was taken at another institution, so the student has
 * nothing to say about UBC's version of it.
 */
export async function canReview(userId: string, courseId: string): Promise<boolean> {
  const found = await db.enrollment.findFirst({
    where: { userId, courseId, verified: true, status: { not: 'transfer' } },
    select: { id: true },
  });
  return found !== null;
}

export async function reviewableCourses(userId: string): Promise<string[]> {
  const rows = await db.enrollment.findMany({
    where: { userId, verified: true, status: { not: 'transfer' } },
    select: { courseId: true },
    distinct: ['courseId'],
  });
  return rows.map((r) => r.courseId);
}
