export const USER_AGENT =
  'UBCFlow/0.1 (course review site; +https://github.com/ryangiang/ubc-flow)';

const MIN_INTERVAL_MS = 1000;
let lastRequestAt = 0;

// ponytail: check-then-act on lastRequestAt races under concurrent callers
// (two calls can read the same value and fire together). Serialize everyone
// through one promise chain so the wait-then-fetch is atomic per call.
let queue: Promise<unknown> = Promise.resolve();

/** Rate-limited to one request per second across the whole process. */
export function fetchText(url: string): Promise<string> {
  const task = queue.then(async () => {
    const wait = lastRequestAt + MIN_INTERVAL_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastRequestAt = Date.now();

    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
    if (!res.ok) throw new Error(`GET ${url} failed: ${res.status}`);
    return res.text();
  });
  // Keep the chain alive even when a call rejects, or one failure stalls everything after it.
  queue = task.catch(() => {});
  return task;
}
