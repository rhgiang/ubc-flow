'use server';

import { loadCourseDetail, type CourseDetail } from '@/lib/course-detail';

/**
 * Course detail for the schedule builder's info overlay, fetched on demand so
 * the builder's initial load stays cheap. Public catalogue data — no auth
 * needed, same as the section search beside it.
 */
export async function getCourseDetail(
  courseId: string,
  termId: string,
): Promise<CourseDetail | null> {
  return loadCourseDetail(courseId, termId);
}
