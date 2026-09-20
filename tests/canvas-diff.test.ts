// tests/canvas-diff.test.ts
import { describe, it, expect } from 'vitest';
import { diffFeed, type StoredDeadline } from '@/canvas/diff';
import type { FeedItem } from '@/canvas/parse-ics';

const item = (uid: string, iso: string): FeedItem => ({
  uid, kind: 'assignment', title: uid, courseName: 'C', dueAt: new Date(iso), allDay: false, url: null,
});
const stored = (id: string, uid: string, iso: string, removed = false): StoredDeadline => ({
  id, uid, dueAt: new Date(iso), removedAt: removed ? new Date('2026-09-01T00:00:00Z') : null,
});

describe('diffFeed', () => {
  it('creates what it has never seen', () => {
    const d = diffFeed([], [item('a', '2026-10-27T06:59:59Z')]);
    expect(d.create.map((i) => i.uid)).toEqual(['a']);
    expect(d.move).toEqual([]);
    expect(d.remove).toEqual([]);
  });

  it('does nothing for an unchanged deadline', () => {
    const d = diffFeed([stored('1', 'a', '2026-10-27T06:59:59Z')], [item('a', '2026-10-27T06:59:59Z')]);
    expect(d).toEqual({ create: [], move: [], restore: [], remove: [] });
  });

  it('records a move with where it moved from', () => {
    const d = diffFeed([stored('1', 'a', '2026-10-27T06:59:59Z')], [item('a', '2026-10-30T06:59:59Z')]);
    expect(d.move).toEqual([{ id: '1', from: new Date('2026-10-27T06:59:59Z'), to: new Date('2026-10-30T06:59:59Z'), restored: false }]);
  });

  it('marks a deadline the feed no longer lists, once', () => {
    const d = diffFeed([stored('1', 'a', '2026-10-27T06:59:59Z'), stored('2', 'b', '2026-10-27T06:59:59Z', true)], []);
    expect(d.remove).toEqual(['1']); // '2' was already removed
  });

  it('keeps only the first of two feed items sharing a uid', () => {
    const d = diffFeed([], [item('a', '2026-10-27T06:59:59Z'), item('a', '2026-10-30T06:59:59Z')]);
    expect(d.create).toHaveLength(1);
    expect(d.create[0].dueAt.toISOString()).toBe('2026-10-27T06:59:59.000Z');
  });

  it('collapses a repeated uid into one move when the uid is already stored', () => {
    const d = diffFeed(
      [stored('1', 'a', '2026-10-27T06:59:59Z')],
      [item('a', '2026-10-30T06:59:59Z'), item('a', '2026-11-02T06:59:59Z')],
    );
    expect(d.create).toEqual([]);
    expect(d.move).toEqual([
      { id: '1', from: new Date('2026-10-27T06:59:59Z'), to: new Date('2026-10-30T06:59:59Z'), restored: false },
    ]);
  });

  it('restores a removed deadline the prof put back, unchanged or moved', () => {
    const same = diffFeed([stored('1', 'a', '2026-10-27T06:59:59Z', true)], [item('a', '2026-10-27T06:59:59Z')]);
    expect(same.restore).toEqual(['1']);
    const moved = diffFeed([stored('1', 'a', '2026-10-27T06:59:59Z', true)], [item('a', '2026-11-01T06:59:59Z')]);
    expect(moved.move[0]).toMatchObject({ id: '1', restored: true });
  });
});
