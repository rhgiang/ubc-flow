import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchText, USER_AGENT } from '@/scrape/http';

describe('fetchText', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('identifies itself with a descriptive User-Agent', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('ok', { status: 200 }),
    );
    await fetchText('https://example.com');
    const init = spy.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>)['User-Agent']).toBe(USER_AGENT);
    expect(USER_AGENT).toMatch(/UBCFlow/);
  });

  it('throws on a non-ok response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('nope', { status: 500 }));
    await expect(fetchText('https://example.com')).rejects.toThrow(/500/);
  });

  it('spaces consecutive requests by at least 1s', async () => {
    // mockResolvedValue would hand out the same Response object twice, and a
    // fetch Body can only be read once — use mockImplementation so each call
    // gets a fresh Response.
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () => new Response('ok', { status: 200 }),
    );
    const start = Date.now();
    await fetchText('https://example.com/a');
    await fetchText('https://example.com/b');
    expect(Date.now() - start).toBeGreaterThanOrEqual(950);
  });
});
