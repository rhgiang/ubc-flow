'use server';

import { del } from '@vercel/blob';
import { revalidatePath } from 'next/cache';
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

/**
 * Takes one course off a student's record: the enrollment, its meetings, its
 * exams, and any syllabus they recorded for it.
 *
 * Remove only, never add. A course gets onto an account exactly one way, from
 * a Workday export, and this exists because of the one thing that import
 * cannot undo: it never prunes a term the uploaded file does not cover (see
 * `keptByTerm` in src/upload/import.ts), because doing so would delete a
 * student's whole graded history on any current-term upload. So a course
 * dropped in a term the new export no longer mentions stays put, and this is
 * the way out.
 *
 * Scoped by userId in the lookup itself, so another student's enrollment is
 * simply not there. Same answer as an id that never existed, never a "yes
 * that is real, but not yours".
 *
 * The syllabus goes with the course rather than being left scoped out of
 * view: it is a private file in blob storage, and nothing else would ever
 * come back for it. Re-uploading an export restores the course, not the
 * syllabus, which the confirm copy says.
 */
export async function removeCourseFor(
  userId: string,
  courseId: string,
  termId: string | null,
): Promise<Result> {
  const enrollment = await db.enrollment.findFirst({
    where: { userId, courseId, termId },
    select: { id: true },
  });
  if (!enrollment) return { ok: false, error: 'Not found.' };

  // An academic-record row has no term, and meetings, assessments and
  // syllabi all key on a real one, so there is nothing else to chase.
  if (termId === null) {
    await db.enrollment.delete({ where: { id: enrollment.id } });
    return { ok: true };
  }

  const scope = { userId, courseId, termId };
  const syllabus = await db.syllabus.findUnique({
    where: { userId_courseId_termId: scope },
    select: { id: true, pathname: true },
  });

  // Blob first, row second, same order as the syllabus DELETE route: if the
  // file cannot be removed, nothing is deleted, rather than orphaning a
  // private file the UI would then claim is gone. A link-only or text-only
  // syllabus has no blob to remove.
  if (syllabus?.pathname) {
    try {
      await del(syllabus.pathname);
    } catch {
      return { ok: false, error: 'Could not remove that course. Try again in a moment.' };
    }
  }

  await db.$transaction([
    db.enrollment.delete({ where: { id: enrollment.id } }),
    db.enrollmentMeeting.deleteMany({ where: scope }),
    // Covers the standalone exams the student typed into the exam view, which
    // have no syllabusId and so would survive the syllabus delete below.
    db.syllabusAssessment.deleteMany({ where: scope }),
    ...(syllabus ? [db.syllabus.delete({ where: { id: syllabus.id } })] : []),
  ]);

  return { ok: true };
}

export async function removeCourse(courseId: string, termId: string | null): Promise<Result> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: 'Sign in to remove a course.' };

  const result = await removeCourseFor(userId, courseId, termId);
  if (result.ok) {
    revalidatePath('/onboarding');
    revalidatePath('/schedule');
  }
  return result;
}
