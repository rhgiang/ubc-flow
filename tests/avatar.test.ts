import { describe, it, expect } from 'vitest';
import { avatarFor } from '@/components/ReviewCard';
import { GLYPHS } from '@/components/avatar-glyphs';

// The avatar renders on the server and again on hydration, so the only thing
// worth testing is that the same id always lands on the same pair — and that
// the pair is always a real one.
describe('avatarFor', () => {
  const ids = Array.from({ length: 500 }, (_, i) => `cm${i.toString(36)}xq${i * 7}`);

  it('is stable for a given id', () => {
    for (const id of ids.slice(0, 20)) {
      expect(avatarFor(id)).toEqual(avatarFor(id));
    }
  });

  it('always picks a glyph that exists', () => {
    for (const id of [...ids, '', 'a', '\u{1f9a1}']) {
      const { glyph, color } = avatarFor(id);
      expect(GLYPHS).toContain(glyph);
      expect(color).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('spreads across the whole set rather than clustering', () => {
    const seen = new Set(ids.map((id) => avatarFor(id).glyph.name));
    expect(seen.size).toBe(GLYPHS.length);
  });

  it('pairs glyphs with more than one colour', () => {
    // The reason avatarFor uses two seeds: a single hash would tie each glyph
    // to exactly one colour.
    const pairs = new Set(ids.map((id) => `${avatarFor(id).glyph.name}|${avatarFor(id).color}`));
    expect(pairs.size).toBeGreaterThan(GLYPHS.length);
  });

  it('has no duplicate glyph names', () => {
    expect(new Set(GLYPHS.map((g) => g.name)).size).toBe(GLYPHS.length);
  });
});
