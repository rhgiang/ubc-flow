import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '@/lib/db';
import { canReview, reviewableCourses } from '@/lib/gate';

const EMAIL = 'zz-gate-test@example.com';
let userId: string;
let enrolledCourseId: string;
let otherCourseId: string;

beforeAll(async () => {
  await db.user.deleteMany({ where: { email: EMAIL } });
  userId = (await db.user.create({ data: { email: EMAIL } })).id;

  const courses = await db.course.findMany({ take: 2, select: { id: true } });
  enrolledCourseId = courses[0].id;
  otherCourseId = courses[1].id;

  const term = await db.term.findFirstOrThrow({ select: { id: true } });
  await db.enrollment.create({
    data: { userId, courseId: enrolledCourseId, termId: term.id, source: 'workday', verified: true },
  });
});

afterAll(async () => {
  await db.enrollment.deleteMany({ where: { userId } });
  await db.user.deleteMany({ where: { email: EMAIL } });
  await db.$disconnect();
});

describe('canReview', () => {
  it('allows a course the user is enrolled in', async () => {
    expect(await canReview(userId, enrolledCourseId)).toBe(true);
  });

  it('denies a course the user never took', async () => {
    expect(await canReview(userId, otherCourseId)).toBe(false);
  });

  it('denies everything for a user with no enrollments', async () => {
    const stranger = await db.user.create({ data: { email: 'zz-stranger@example.com' } });
    expect(await canReview(stranger.id, enrolledCourseId)).toBe(false);
    await db.user.delete({ where: { id: stranger.id } });
  });

  it('denies an unverified enrollment', async () => {
    await db.enrollment.updateMany({ where: { userId }, data: { verified: false } });
    expect(await canReview(userId, enrolledCourseId)).toBe(false);
    await db.enrollment.updateMany({ where: { userId }, data: { verified: true } });
  });
});

describe('reviewableCourses', () => {
  it('lists exactly the enrolled courses', async () => {
    expect(await reviewableCourses(userId)).toEqual([enrolledCourseId]);
  });
});
