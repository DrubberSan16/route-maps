import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * API keys look like `rmk_<12 hex>_<43 base64url>`. The first part (`rmk_<12 hex>`) is public and
 * finds the key; the whole key is only shown once and only its SHA-256 is stored.
 */
const KEY_PATTERN = /^(rmk_[0-9a-f]{12})_[A-Za-z0-9_-]{43}$/;

export interface GeneratedApiKey {
  /** The secret to hand to the integration; never stored. */
  key: string;
  prefix: string;
  hash: string;
  lastFour: string;
}

export const hashApiKey = (key: string): string => createHash('sha256').update(key).digest('hex');

export function generateApiKey(): GeneratedApiKey {
  const prefix = `rmk_${randomBytes(6).toString('hex')}`;
  const key = `${prefix}_${randomBytes(32).toString('base64url')}`;
  return { key, prefix, hash: hashApiKey(key), lastFour: key.slice(-4) };
}

/** Public part of a well-formed key, or null. */
export const apiKeyPrefix = (raw: string): string | null => KEY_PATTERN.exec(raw)?.[1] ?? null;

/** Constant-time comparison of a presented key with a stored hash. */
export function apiKeyMatches(raw: string, storedHash: string): boolean {
  const presented = Buffer.from(hashApiKey(raw), 'hex');
  const stored = Buffer.from(storedHash, 'hex');
  return presented.length === stored.length && timingSafeEqual(presented, stored);
}
