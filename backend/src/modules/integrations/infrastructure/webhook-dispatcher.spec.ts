import { WebhookDeliveryStatus } from '../../../generated/prisma/enums';
import { MAX_ATTEMPTS, RETRY_DELAYS_MS } from '../domain/webhook-retries';
import { nextState } from './webhook-dispatcher';

describe('nextState', () => {
  const now = Date.parse('2026-10-07T12:00:00Z');
  const options = { singleAttempt: false, now };

  it('marks any 2xx answer as delivered', () => {
    for (const status of [200, 201, 202, 204, 299]) {
      expect(nextState(1, { status, durationMs: 5 }, options)).toEqual({
        status: WebhookDeliveryStatus.SUCCEEDED,
        nextAttemptAt: new Date(now),
      });
    }
  });

  it('retries other answers and network errors with growing waits', () => {
    for (const response of [
      { status: 301, durationMs: 5 },
      { status: 404, durationMs: 5 },
      { status: 500, durationMs: 5 },
      { error: 'No answer within 10000 ms', durationMs: 10_000 },
    ]) {
      expect(nextState(1, response, options)).toEqual({
        status: WebhookDeliveryStatus.PENDING,
        nextAttemptAt: new Date(now + RETRY_DELAYS_MS[0]),
      });
    }
    expect(nextState(3, { status: 503, durationMs: 1 }, options).nextAttemptAt).toEqual(
      new Date(now + 30 * 60_000),
    );
    expect(nextState(MAX_ATTEMPTS - 1, { status: 503, durationMs: 1 }, options)).toEqual({
      status: WebhookDeliveryStatus.PENDING,
      nextAttemptAt: new Date(now + 24 * 3_600_000),
    });
  });

  it('fails for good after the last attempt', () => {
    expect(MAX_ATTEMPTS).toBe(8);
    expect(nextState(MAX_ATTEMPTS, { status: 500, durationMs: 1 }, options)).toEqual({
      status: WebhookDeliveryStatus.FAILED,
      nextAttemptAt: new Date(now),
    });
  });

  it('tries test events only once', () => {
    expect(
      nextState(1, { error: 'ECONNREFUSED', durationMs: 1 }, { singleAttempt: true, now }).status,
    ).toBe(WebhookDeliveryStatus.FAILED);
    expect(nextState(1, { status: 200, durationMs: 1 }, { singleAttempt: true, now }).status).toBe(
      WebhookDeliveryStatus.SUCCEEDED,
    );
  });

  it('spreads the attempts over almost two days', () => {
    const total = RETRY_DELAYS_MS.reduce((sum, delay) => sum + delay, 0);
    expect(total / 3_600_000).toBeCloseTo(44.6, 1);
  });
});
