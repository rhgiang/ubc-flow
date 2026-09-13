'use server';

import { revalidatePath, revalidateTag } from 'next/cache';
import { db } from '@/lib/db';
import { auth } from '@/lib/auth';
import { canReview } from '@/lib/gate';
import {
  validateCourseRating,
  validateInstructorRating,
  type CourseRatingInput,
  type InstructorRatingInput,
} from '@/reviews/validate';

export type InstructorRatingSubmission = InstructorRatingInput & { instructorId: string };
type ActionResult = { ok: true } | { ok: false; error: string };

/**
 * The gate lives here, server-side. Hiding the form in the UI is a
 * convenience, not a control - a forged request lands in this function.
 */
export async function writeReviewForUser(
  userId: string,
  courseId: string,
  course: CourseRatingInput,
  instructors: InstructorRatingSubmission[],
): Promise<ActionResult> {
  if (!(await canReview(userId, courseId))) {
    return { ok: false, error: 'You can only review courses you have taken.' };
  }

  const courseCheck = validateCourseRating(course);
  if (!courseCheck.ok) return courseCheck;

  const checked: InstructorRatingSubmission[] = [];
  for (const entry of instructors) {
    const result = validateInstructorRating(entry);
    if (!result.ok) return result;
    checked.push({ ...result.value, instructorId: entry.instructorId });
  }

  await db.$transaction(async (tx) => {
    await tx.courseReview.upsert({
      where: { userId_courseId: { userId, courseId } },
      create: { userId, courseId, ...courseCheck.value },
      update: { ...courseCheck.value },
    });

    // The submitted selection is the complete intended state, so instructor
    // reviews the user removed must be deleted, not left behind.
    await tx.instructorReview.deleteMany({
      where: {
        userId,
        courseId,
        instructorId: { notIn: checked.map((c) => c.instructorId) },
      },
    });

    for (const entry of checked) {
      const { instructorId, ...values } = entry;
      await tx.instructorReview.upsert({
        where: { userId_instructorId_courseId: { userId, instructorId, courseId } },
        create: { userId, instructorId, courseId, ...values },
        update: { ...values },
      });
    }
  });

  return { ok: true };
}

export async function deleteReviewForUser(
  userId: string,
  courseId: string,
): Promise<ActionResult> {
  const existing = await db.courseReview.findUnique({
    where: { userId_courseId: { userId, courseId } },
    select: { id: true },
  });
  // Ownership is enforced by the composite key, not a client-supplied id.
  if (!existing) return { ok: false, error: 'No review to delete.' };

  await db.$transaction(async (tx) => {
    await tx.instructorReview.deleteMany({ where: { userId, courseId } });
    await tx.courseReview.delete({ where: { userId_courseId: { userId, courseId } } });
  });

  return { ok: true };
}

async function currentUserId(): Promise<string | null> {
  const session = await auth();
  return session?.user?.id ?? null;
}

export async function submitReview(
  courseId: string,
  courseCode: string,
  course: CourseRatingInput,
  instructors: InstructorRatingSubmission[],
): Promise<ActionResult> {
  const userId = await currentUserId();
  if (!userId) return { ok: false, error: 'Sign in to write a review.' };

  const result = await writeReviewForUser(userId, courseId, course, instructors);
  if (result.ok) {
    // The course, professor and explore pages cache catalogue data under this
    // tag; without clearing it a new review hides for up to an hour, and the
    // path revalidation alone misses the professor pages instructor reviews
    // also render on.
    revalidateTag('catalogue', { expire: 0 });
    revalidatePath(`/course/${courseCode}`);
  }
  return result;
}

export async function deleteReview(
  courseId: string,
  courseCode: string,
): Promise<ActionResult> {
  const userId = await currentUserId();
  if (!userId) return { ok: false, error: 'Sign in to manage your reviews.' };

  const result = await deleteReviewForUser(userId, courseId);
  if (result.ok) {
    revalidateTag('catalogue', { expire: 0 });
    revalidatePath(`/course/${courseCode}`);
  }
  return result;
}

/**
 * Loads the signed-in user's own review for pre-filling the edit form.
 * Not in the brief's code sample (only listed in "Produces") - added here
 * since Task 4 needs it. Read-only and scoped to the session's own userId,
 * so it carries none of the gate's write-path risk.
 */
export async function getMyReview(
  courseId: string,
): Promise<{ course: Awaited<ReturnType<typeof db.courseReview.findUnique>>; instructors: Awaited<ReturnType<typeof db.instructorReview.findMany>> } | null> {
  const userId = await currentUserId();
  if (!userId) return null;

  const [course, instructors] = await Promise.all([
    db.courseReview.findUnique({ where: { userId_courseId: { userId, courseId } } }),
    db.instructorReview.findMany({ where: { userId, courseId } }),
  ]);

  return { course, instructors };
}
