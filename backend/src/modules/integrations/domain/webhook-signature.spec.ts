import { createHmac } from 'node:crypto';
import {
  generateWebhookSecret,
  signatureHeader,
  signPayload,
  verifySignature,
} from './webhook-signature';

describe('webhook signatures', () => {
  const secret = 'whsec_test-secret';
  const body = JSON.stringify({ id: 'evt-1', type: 'trip.started', data: { trip: { id: 't' } } });
  const now = 1_790_000_000;

  it('signs "<timestamp>.<body>" with HMAC-SHA256, as documented for receivers', () => {
    const expected = createHmac('sha256', secret).update(`${now}.${body}`).digest('hex');
    expect(signPayload(secret, now, body)).toBe(expected);
    expect(signatureHeader(secret, now, body)).toBe(`t=${now},v1=${expected}`);
  });

  it('verifies its own header', () => {
    expect(verifySignature(secret, signatureHeader(secret, now, body), body, { now })).toBe(true);
  });

  it('refuses another secret, a changed body or a changed timestamp', () => {
    const header = signatureHeader(secret, now, body);
    expect(verifySignature('whsec_other', header, body, { now })).toBe(false);
    expect(verifySignature(secret, header, `${body} `, { now })).toBe(false);
    const moved = header.replace(`t=${now}`, `t=${now + 1}`);
    expect(verifySignature(secret, moved, body, { now })).toBe(false);
  });

  it('refuses old or future timestamps (replays) beyond the tolerance', () => {
    const header = signatureHeader(secret, now, body);
    expect(verifySignature(secret, header, body, { now: now + 300 })).toBe(true);
    expect(verifySignature(secret, header, body, { now: now + 301 })).toBe(false);
    expect(verifySignature(secret, header, body, { now: now - 301 })).toBe(false);
    expect(verifySignature(secret, header, body, { now: now + 1000, toleranceSeconds: 1000 })).toBe(
      true,
    );
  });

  it('accepts any of several v1 values (secret rotation on the receiver side)', () => {
    const valid = signPayload(secret, now, body);
    const header = `t=${now},v1=${'0'.repeat(64)},v1=${valid}`;
    expect(verifySignature(secret, header, body, { now })).toBe(true);
  });

  it('refuses malformed headers', () => {
    for (const header of ['', 'v1=abc', `t=abc,v1=${signPayload(secret, now, body)}`, `t=${now}`]) {
      expect(verifySignature(secret, header, body, { now })).toBe(false);
    }
    expect(verifySignature(secret, `t=${now},v1=zz`, body, { now })).toBe(false);
  });

  it('generates distinct secrets with a recognisable prefix', () => {
    const first = generateWebhookSecret();
    expect(first).toMatch(/^whsec_[A-Za-z0-9_-]{43}$/);
    expect(generateWebhookSecret()).not.toBe(first);
  });
});
