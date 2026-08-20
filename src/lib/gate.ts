import { db } from '@/lib/db';

/**
 * The review gate: a user may only review a course they have a VERIFIED
 * enrollment in. Phase 3 must call this before accepting any review.
 */
export async function canReview(userId: string, courseId: string): Promise<boolean> {
  const found = await db.enrollment.findFirst({
    where: { userId, courseId, verified: true },
    select: { id: true },
  });
  return found !== null;
}

export async function reviewableCourses(userId: string): Promise<string[]> {
  const rows = await db.enrollment.findMany({
    where: { userId, verified: true },
    select: { courseId: true },
    distinct: ['courseId'],
  });
  return rows.map((r) => r.courseId);
}
