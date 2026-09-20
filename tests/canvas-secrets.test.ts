import { describe, it, expect, beforeAll } from 'vitest';
import { decryptFeedUrl, encryptFeedUrl } from '@/canvas/crypto';
import { normalizeFeedUrl } from '@/canvas/feed-url';

beforeAll(() => {
  // 32 bytes, hex. Tests never read the real key.
  process.env.FEED_ENCRYPTION_KEY ??= '00'.repeat(31) + '01';
});

describe('feed URL encryption', () => {
  const url = 'https://canvas.ubc.ca/feeds/calendars/user_abc123.ics';

  it('round-trips', () => {
    expect(decryptFeedUrl(encryptFeedUrl(url))).toBe(url);
  });

  it('uses a fresh IV, so the same URL never encrypts to the same blob', () => {
    expect(encryptFeedUrl(url)).not.toBe(encryptFeedUrl(url));
  });

  it('refuses a tampered blob rather than returning garbage', () => {
    const blob = encryptFeedUrl(url);
    const bytes = Buffer.from(blob, 'base64');
    bytes[bytes.length - 1] ^= 0x01;
    expect(() => decryptFeedUrl(bytes.toString('base64'))).toThrow();
  });
});

describe('normalizeFeedUrl', () => {
  it('accepts the real feed shape', () => {
    expect(normalizeFeedUrl(' https://canvas.ubc.ca/feeds/calendars/user_abc.ics ')).toEqual({
      ok: true,
      url: 'https://canvas.ubc.ca/feeds/calendars/user_abc.ics',
    });
  });

  it('rewrites webcal to https', () => {
    expect(normalizeFeedUrl('webcal://canvas.ubc.ca/feeds/calendars/user_abc.ics')).toEqual({
      ok: true,
      url: 'https://canvas.ubc.ca/feeds/calendars/user_abc.ics',
    });
  });

  // The only defence against our server fetching an arbitrary host.
  it.each([
    ['https://evil.example/feeds/calendars/x.ics', 'host'],
    ['https://canvas.ubc.ca.evil.example/feeds/calendars/x.ics', 'host'],
    ['https://canvas.ubc.ca/courses/1', 'feeds'],
    ['http://canvas.ubc.ca/feeds/calendars/x.ics', 'https'],
    ['https://169.254.169.254/feeds/calendars/x.ics', 'host'],
    ['javascript:alert(1)', ''],
    ['not a url', ''],
    ['', ''],
  ])('rejects %s', (input, _hint) => {
    expect(normalizeFeedUrl(input).ok).toBe(false);
  });

  it('caps length', () => {
    expect(normalizeFeedUrl('https://canvas.ubc.ca/feeds/calendars/' + 'a'.repeat(600)).ok).toBe(false);
  });
});
