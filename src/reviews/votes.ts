import { db } from '@/lib/db';

/**
 * Vote totals for a set of reviews, plus which of them this user has voted on.
 * One group-by and one lookup rather than a count per card.
 */
export async function voteSummary(
  reviewIds: string[],
  userId: string | null,
): Promise<{ counts: Map<string, number>; mine: Set<string> }> {
  if (reviewIds.length === 0) return { counts: new Map(), mine: new Set() };

  const [grouped, ownVotes] = await Promise.all([
    db.reviewVote.groupBy({
      by: ['reviewId'],
      where: { reviewId: { in: reviewIds } },
      _count: { reviewId: true },
    }),
    userId
      ? db.reviewVote.findMany({
          where: { userId, reviewId: { in: reviewIds } },
          select: { reviewId: true },
        })
      : Promise.resolve([]),
  ]);

  return {
    counts: new Map(grouped.map((g) => [g.reviewId, g._count.reviewId])),
    mine: new Set(ownVotes.map((v) => v.reviewId)),
  };
}
