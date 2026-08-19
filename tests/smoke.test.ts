import { describe, it, expect } from 'vitest';
import { APP_NAME } from '@/lib/version';

describe('scaffold', () => {
  it('runs typescript tests', () => {
    expect(1 + 1).toBe(2);
  });

  it('resolves @/ alias', () => {
    expect(APP_NAME).toBe('UBC Flow');
  });
});
