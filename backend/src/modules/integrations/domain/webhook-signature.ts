import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** Header with the signature of every webhook request: `t=<unix seconds>,v1=<hex HMAC-SHA256>`. */
export const SIGNATURE_HEADER = 'x-routemaps-signature';

/** Signing secret of a webhook endpoint (shown once, stored encrypted). */
export const generateWebhookSecret = (): string => `whsec_${randomBytes(32).toString('base64url')}`;

/** HMAC-SHA256 (hex) of `<timestamp>.<body>` with the endpoint's secret. */
export const signPayload = (secret: string, timestamp: number, body: string): string =>
  createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');

export const signatureHeader = (secret: string, timestamp: number, body: string): string =>
  `t=${timestamp},v1=${signPayload(secret, timestamp, body)}`;

/**
 * Receiver side (documented in docs/integration.md, used by the tests): the header is valid when
 * one of its v1 values matches and its timestamp is within `toleranceSeconds` of `now`.
 */
export function verifySignature(
  secret: string,
  header: string,
  body: string,
  options: { now?: number; toleranceSeconds?: number } = {},
): boolean {
  const parts = header.split(',').map((part) => part.trim().split('='));
  const timestamp = Number(parts.find(([name]) => name === 't')?.[1]);
  if (!Number.isInteger(timestamp)) return false;
  const now = options.now ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > (options.toleranceSeconds ?? 300)) return false;
  const expected = Buffer.from(signPayload(secret, timestamp, body), 'hex');
  return parts
    .filter(([name, value]) => name === 'v1' && /^[0-9a-f]{64}$/.test(value ?? ''))
    .some(([, value]) => timingSafeEqual(Buffer.from(value, 'hex'), expected));
}
