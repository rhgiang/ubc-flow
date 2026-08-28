import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '@/lib/db';
import { toggleReviewVoteFor } from '@/app/actions/review-votes';

const VOTER = 'zz-vote-voter@example.com';
const AUTHOR = 'zz-vote-author@example.com';
let voterId: string;
let authorId: string;
let reviewId: string;
let courseId: string;

beforeAll(async () => {
  await db.user.deleteMany({ where: { email: { in: [VOTER, AUTHOR] } } });
  voterId = (await db.user.create({ data: { email: VOTER } })).id;
  authorId = (await db.user.create({ data: { email: AUTHOR } })).id;

  const course = await db.course.findFirstOrThrow({ select: { id: true } });
  courseId = course.id;
  reviewId = (
    await db.courseReview.create({ data: { userId: authorId, courseId, text: 'x' } })
  ).id;
});

afterAll(async () => {
  await db.reviewVote.deleteMany({ where: { reviewId } });
  await db.courseReview.deleteMany({ where: { userId: authorId } });
  await db.user.deleteMany({ where: { email: { in: [VOTER, AUTHOR] } } });
  await db.$disconnect();
});

describe('toggleReviewVoteFor', () => {
  it('adds a vote, then takes the same one back', async () => {
    const up = await toggleReviewVoteFor(voterId, reviewId, 'course');
    expect(up).toEqual({ ok: true, voted: true, votes: 1 });

    const down = await toggleReviewVoteFor(voterId, reviewId, 'course');
    expect(down).toEqual({ ok: true, voted: false, votes: 0 });
  });

  it('counts one person once, however many times they press it', async () => {
    await toggleReviewVoteFor(voterId, reviewId, 'course');
    await toggleReviewVoteFor(voterId, reviewId, 'course');
    await toggleReviewVoteFor(voterId, reviewId, 'course');
    expect(await db.reviewVote.count({ where: { reviewId } })).toBe(1);
  });

  it('refuses a vote on a review that does not exist', async () => {
    const r = await toggleReviewVoteFor(voterId, 'no-such-review', 'course');
    expect(r.ok).toBe(false);
  });
});
