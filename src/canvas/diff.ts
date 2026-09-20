// src/canvas/diff.ts
import type { FeedItem } from './parse-ics';

export type StoredDeadline = { id: string; uid: string; dueAt: Date; removedAt: Date | null };

export type FeedDiff = {
  create: FeedItem[];
  move: { id: string; from: Date; to: Date; restored: boolean }[];
  restore: string[];
  remove: string[];
};

/** Pure. Keyed on Canvas's UID, which is stable across polls. A row that
 *  drops out of the feed is marked removed once and left alone after; a row
 *  that comes back is restored, moved or not. */
export function diffFeed(stored: StoredDeadline[], items: FeedItem[]): FeedDiff {
  const byUid = new Map(stored.map((s) => [s.uid, s]));
  const seen = new Set<string>();
  const diff: FeedDiff = { create: [], move: [], restore: [], remove: [] };

  for (const it of items) {
    // First occurrence wins. RFC 5545 lets a recurrence override repeat a UID
    // with a RECURRENCE-ID, and the parser reads neither, so a feed can hand
    // us the same uid twice. Two creates for one uid means P2002 on
    // @@unique([userId, uid]), which aborts applyDiff's whole transaction and
    // loses every other new deadline in the same run, every run, forever.
    if (seen.has(it.uid)) continue;
    seen.add(it.uid);
    const s = byUid.get(it.uid);
    if (!s) {
      diff.create.push(it);
      continue;
    }
    const wasRemoved = s.removedAt !== null;
    if (s.dueAt.getTime() !== it.dueAt.getTime()) {
      diff.move.push({ id: s.id, from: s.dueAt, to: it.dueAt, restored: wasRemoved });
    } else if (wasRemoved) {
      diff.restore.push(s.id);
    }
  }
  for (const s of stored) {
    if (!seen.has(s.uid) && s.removedAt === null) diff.remove.push(s.id);
  }
  return diff;
}
