import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const IV_BYTES = 12;
const TAG_BYTES = 16;

/** Separate from SERVER_SECRET on purpose: that key hashes student numbers
 *  and must never rotate; this one should be rotatable on its own. */
function key(): Buffer {
  const hex = process.env.FEED_ENCRYPTION_KEY;
  if (!hex || !/^[0-9a-f]{64}$/i.test(hex)) {
    throw new Error('FEED_ENCRYPTION_KEY is not set to 32 hex bytes. Refusing to handle feed URLs unkeyed.');
  }
  return Buffer.from(hex, 'hex');
}

/** For the job's startup: fail before the loop, loudly, the way hash.ts
 *  refuses without SERVER_SECRET. Without this a missing key would surface
 *  as one caught error per feed and a run that looks like it did its job. */
export function assertFeedKey(): void {
  key();
}

export function encryptFeedUrl(url: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const ct = Buffer.concat([cipher.update(url, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]).toString('base64');
}

export function decryptFeedUrl(blob: string): string {
  const bytes = Buffer.from(blob, 'base64');
  const iv = bytes.subarray(0, IV_BYTES);
  const tag = bytes.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ct = bytes.subarray(IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv('aes-256-gcm', key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}
