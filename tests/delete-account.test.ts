import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '@/lib/db';
import { deleteAccountFor } from '@/app/actions/account';

const TARGET = 'zz-delete-target@example.com';
const VOTER = 'zz-delete-voter@example.com';
const BYSTANDER = 'zz-delete-bystander@example.com';

let targetId: string;
let voterId: string;
let bystanderId: string;
let courseId: string;
let termId: string;

beforeAll(async () => {
  await db.user.deleteMany({ where: { email: { in: [TARGET, VOTER, BYSTANDER] } } });
  targetId = (await db.user.create({ data: { email: TARGET } })).id;
  voterId = (await db.user.create({ data: { email: VOTER } })).id;
  bystanderId = (await db.user.create({ data: { email: BYSTANDER } })).id;

  const section = await db.section.findFirstOrThrow({ select: { courseId: true, termId: true } });
  courseId = section.courseId;
  termId = section.termId;
});

afterAll(async () => {
  await db.user.deleteMany({ where: { email: { in: [TARGET, VOTER, BYSTANDER] } } });
  await db.$disconnect();
});

describe('deleteAccountFor', () => {
  it('removes the account and every table with data tied to it', async () => {
    await db.savedSchedule.create({ data: { userId: targetId, termId, name: 'Plan' } });
    await db.enrollment.create({
      data: { userId: targetId, courseId, termId, source: 'test' },
    });
    await db.enrollmentMeeting.create({
      data: { userId: targetId, courseId, termId, days: [] },
    });
    await db.courseReview.create({ data: { userId: targetId, courseId, text: 'x' } });

    const result = await deleteAccountFor(targetId);
    expect(result.ok).toBe(true);

    expect(await db.user.findUnique({ where: { id: targetId } })).toBeNull();
    expect(await db.savedSchedule.count({ where: { userId: targetId } })).toBe(0);
    expect(await db.enrollment.count({ where: { userId: targetId } })).toBe(0);
    expect(await db.enrollmentMeeting.count({ where: { userId: targetId } })).toBe(0);
    expect(await db.courseReview.count({ where: { userId: targetId } })).toBe(0);
  });

  it("clears another student's vote on the deleted review, without deleting that student", async () => {
    const author = (
      await db.user.create({ data: { email: 'zz-delete-author2@example.com' } })
    ).id;
    const review = await db.courseReview.create({
      data: { userId: author, courseId, text: 'vote target' },
    });
    await db.reviewVote.create({ data: { userId: voterId, reviewId: review.id, kind: 'course' } });

    expect(await db.reviewVote.count({ where: { reviewId: review.id } })).toBe(1);

    await deleteAccountFor(author);

    // The review vanished with its author (real FK, cascades on its own) -
    // the point of this test is the vote, which has no FK to follow.
    expect(await db.courseReview.findUnique({ where: { id: review.id } })).toBeNull();
    expect(await db.reviewVote.count({ where: { reviewId: review.id } })).toBe(0);
    // The voter is a bystander here, not the account being deleted.
    expect(await db.user.findUnique({ where: { id: voterId } })).not.toBeNull();

    await db.user.deleteMany({ where: { email: 'zz-delete-author2@example.com' } });
  });

  it("never touches an unrelated user's data", async () => {
    const schedule = await db.savedSchedule.create({
      data: { userId: bystanderId, termId, name: 'Untouched' },
    });

    const victim = (
      await db.user.create({ data: { email: 'zz-delete-victim@example.com' } })
    ).id;
    await deleteAccountFor(victim);

    expect(await db.user.findUnique({ where: { id: bystanderId } })).not.toBeNull();
    expect(await db.savedSchedule.findUnique({ where: { id: schedule.id } })).not.toBeNull();

    await db.savedSchedule.delete({ where: { id: schedule.id } });
  });

  it('frees the student number for reuse once the account holding it is gone', async () => {
    const digest = 'zz-delete-student-hash';
    const first = (
      await db.user.create({
        data: { email: 'zz-delete-first@example.com', studentIdHash: digest },
      })
    ).id;

    // importExport's own binding guard (src/upload/import.ts:22-28): a live
    // row holding this hash blocks anyone else from claiming it.
    expect(await db.user.findUnique({ where: { studentIdHash: digest } })).not.toBeNull();

    await deleteAccountFor(first);

    // Deleted, not just unverified - the same hash must be claimable again,
    // by a returning student re-registering or a different account entirely.
    expect(await db.user.findUnique({ where: { studentIdHash: digest } })).toBeNull();

    const second = await db.user.create({
      data: { email: 'zz-delete-second@example.com', studentIdHash: digest },
    });
    expect(second.studentIdHash).toBe(digest);

    await db.user.deleteMany({
      where: { email: { in: ['zz-delete-first@example.com', 'zz-delete-second@example.com'] } },
    });
  });
});
