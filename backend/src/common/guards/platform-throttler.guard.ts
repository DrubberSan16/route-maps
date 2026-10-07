import { Injectable } from '@nestjs/common';
import { ThrottlerGuard, ThrottlerRequest } from '@nestjs/throttler';
import type { AuthenticatedUser } from '../types/authenticated-user';

/** Window of the per-integration quota (`Integration.rateLimitPerMinute`). */
const INTEGRATION_WINDOW_MS = 60_000;

/**
 * Rate limits of the API. People and anonymous clients keep the per-route limits by IP address
 * (`@Throttle`, RATE_LIMIT_*). Requests made with an API key share one budget per integration
 * across every route, set by the administrators for each integration; it runs after the
 * authentication guard, which identifies the integration.
 */
@Injectable()
export class PlatformThrottlerGuard extends ThrottlerGuard {
  protected override async handleRequest(requestProps: ThrottlerRequest): Promise<boolean> {
    const { req } = this.getRequestResponse(requestProps.context);
    const apiKey = (req as { user?: AuthenticatedUser }).user?.apiKey;
    if (!apiKey) return super.handleRequest(requestProps);
    return super.handleRequest({
      ...requestProps,
      limit: apiKey.rateLimitPerMinute,
      ttl: INTEGRATION_WINDOW_MS,
      blockDuration: INTEGRATION_WINDOW_MS,
      getTracker: () => `integration:${apiKey.integrationId}`,
      generateKey: (_context, tracker, name) => `${name}:${tracker}`,
    });
  }
}
