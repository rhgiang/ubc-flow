export const USER_AGENT =
  'UBCFlow/0.1 (course review site; +https://github.com/ryangiang/ubc-flow)';

const MIN_INTERVAL_MS = 1000;
let lastRequestAt = 0;

/** Rate-limited to one request per second across the whole process. */
export async function fetchText(url: string): Promise<string> {
  const wait = lastRequestAt + MIN_INTERVAL_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequestAt = Date.now();

  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error(`GET ${url} failed: ${res.status}`);
  return res.text();
}
