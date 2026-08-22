import { describe, it, expect } from 'vitest';
import { diffSections } from '@/schedule/buffer';

describe('diffSections', () => {
  it('reports only additions when nothing was removed', () => {
    expect(diffSections(['a'], ['a', 'b'])).toEqual({ added: ['b'], removed: [] });
  });

  it('reports only removals when nothing was added', () => {
    expect(diffSections(['a', 'b'], ['a'])).toEqual({ added: [], removed: ['b'] });
  });

  it('reports nothing for an unchanged set regardless of order', () => {
    expect(diffSections(['a', 'b'], ['b', 'a'])).toEqual({ added: [], removed: [] });
  });

  it('treats a repeated id as one section', () => {
    expect(diffSections([], ['a', 'a'])).toEqual({ added: ['a'], removed: [] });
  });

  it('removes everything when the next set is empty', () => {
    expect(diffSections(['a', 'b'], [])).toEqual({ added: [], removed: ['a', 'b'] });
  });
});
