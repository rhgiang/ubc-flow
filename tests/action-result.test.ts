import { describe, it, expect } from 'vitest';
import { settled, UNREACHABLE } from '@/lib/action-result';

describe('settled', () => {
  it('passes a real answer through untouched, whatever else it carries', async () => {
    const ok = { ok: true as const, voted: true, votes: 7 };
    expect(await settled(Promise.resolve(ok))).toBe(ok);
    const refused = { ok: false as const, error: 'Not found.' };
    expect(await settled(Promise.resolve(refused))).toBe(refused);
  });

  it('turns a request that never landed into a refusal, not a rejection', async () => {
    // The whole point: a handler awaiting this must reach its error branch
    // rather than throwing past it and leaving the screen mid-change.
    const result = await settled(Promise.reject(new TypeError('Failed to fetch')));
    expect(result).toEqual({ ok: false, error: UNREACHABLE });
  });

  it('says the connection failed, not that the app refused', async () => {
    // A server that answers "Not found." and a server that was never reached
    // are different facts, and the person can only act on one of them.
    expect(UNREACHABLE).toMatch(/connection/i);
  });
});
