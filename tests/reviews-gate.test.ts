import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '@/lib/db';
import { writeReviewForUser, deleteReviewForUser } from '@/app/actions/reviews';

const ENROLLED = 'zz-review-enrolled@example.com';
const STRANGER = 'zz-review-stranger@example.com';

let enrolledId: string;
let strangerId: string;
let courseId: string;
let otherCourseId: string;

beforeAll(async () => {
  process.env.SERVER_SECRET ??= 'test-secret';
  await db.user.deleteMany({ where: { email: { in: [ENROLLED, STRANGER] } } });

  enrolledId = (await db.user.create({ data: { email: ENROLLED } })).id;
  strangerId = (await db.user.create({ data: { email: STRANGER } })).id;

  const courses = await db.course.findMany({ take: 2, select: { id: true } });
  courseId = courses[0].id;
  otherCourseId = courses[1].id;

  const term = await db.term.findFirstOrThrow({ select: { id: true } });
  await db.enrollment.create({
    data: { userId: enrolledId, courseId, termId: term.id, source: 'workday', verified: true },
  });
});

afterAll(async () => {
  await db.courseReview.deleteMany({ where: { userId: { in: [enrolledId, strangerId] } } });
  await db.instructorReview.deleteMany({ where: { userId: { in: [enrolledId, strangerId] } } });
  await db.enrollment.deleteMany({ where: { userId: { in: [enrolledId, strangerId] } } });
  await db.user.deleteMany({ where: { email: { in: [ENROLLED, STRANGER] } } });
  await db.$disconnect();
});

const rating = { liked: true, useful: 3, difficulty: 2, workloadHours: 8, text: 'Fine.' };

describe('the review gate', () => {
  it('lets a verified-enrolled user write a review', async () => {
    const r = await writeReviewForUser(enrolledId, courseId, rating, []);
    expect(r.ok).toBe(true);
    expect(await db.courseReview.count({ where: { userId: enrolledId, courseId } })).toBe(1);
  });

  it('REJECTS a user with no enrollment in that course', async () => {
    const r = await writeReviewForUser(strangerId, courseId, rating, []);
    expect(r.ok).toBe(false);
    expect(await db.courseReview.count({ where: { userId: strangerId } })).toBe(0);
  });

  it('REJECTS a course the user is not enrolled in, even though they are enrolled elsewhere', async () => {
    const r = await writeReviewForUser(enrolledId, otherCourseId, rating, []);
    expect(r.ok).toBe(false);
    expect(await db.courseReview.count({ where: { userId: enrolledId, courseId: otherCourseId } })).toBe(0);
  });

  it('REJECTS a write when the enrollment exists but is unverified', async () => {
    await db.enrollment.updateMany({ where: { userId: enrolledId, courseId }, data: { verified: false } });
    const r = await writeReviewForUser(enrolledId, courseId, rating, []);
    expect(r.ok).toBe(false);
    await db.enrollment.updateMany({ where: { userId: enrolledId, courseId }, data: { verified: true } });
  });

  it('rejects an out-of-range score before touching the database', async () => {
    const r = await writeReviewForUser(enrolledId, courseId, { ...rating, useful: 99 }, []);
    expect(r.ok).toBe(false);
  });

  it('is an upsert — a second submission edits rather than duplicating', async () => {
    await writeReviewForUser(enrolledId, courseId, { ...rating, useful: 4 }, []);
    const rows = await db.courseReview.findMany({ where: { userId: enrolledId, courseId } });
    expect(rows).toHaveLength(1);
    expect(rows[0].useful).toBe(4);
  });
});

describe('delete', () => {
  it('deletes only the requesting user\'s own review', async () => {
    await writeReviewForUser(enrolledId, courseId, rating, []);
    // A stranger cannot delete someone else's review for that course.
    const bad = await deleteReviewForUser(strangerId, courseId);
    expect(bad.ok).toBe(false);
    expect(await db.courseReview.count({ where: { userId: enrolledId, courseId } })).toBe(1);

    const good = await deleteReviewForUser(enrolledId, courseId);
    expect(good.ok).toBe(true);
    expect(await db.courseReview.count({ where: { userId: enrolledId, courseId } })).toBe(0);
  });
});
