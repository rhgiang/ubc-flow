// src/canvas/fetch-feed.ts
export const FEED_TIMEOUT_MS = 20_000;
export const FEED_MAX_BYTES = 2 * 1024 * 1024;

/**
 * One fetch, bounded two ways. A feed is tens of kilobytes; a body past the
 * cap is wrong and is discarded. Status 0 means the request itself failed
 * (timeout, DNS, reset), which callers treat as transient.
 *
 * Callers pass a URL that has ALREADY been through normalizeFeedUrl. This
 * function does not re-check the host; the job does, before calling it.
 */
export async function fetchFeed(url: string): Promise<{ status: number; body: string | null }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FEED_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'text/calendar', 'User-Agent': 'UBCFlow/0.1 (+https://ubcflow.com)' },
      redirect: 'manual',
    });
    if (res.status !== 200) return { status: res.status, body: null };
    const length = Number(res.headers.get('content-length') ?? 0);
    if (length > FEED_MAX_BYTES) return { status: 200, body: null };
    const text = await res.text();
    if (text.length > FEED_MAX_BYTES) return { status: 200, body: null };
    return { status: 200, body: text };
  } catch {
    return { status: 0, body: null };
  } finally {
    clearTimeout(timer);
  }
}
