import { RoutingProfile } from './value-objects/routing-profile';

/** No path exists between the requested points (or they are too far from any road). */
export class RouteNotFoundError extends Error {
  constructor(
    message: string,
    public readonly providerCode?: number | string,
  ) {
    super(message);
    this.name = 'RouteNotFoundError';
  }
}

/** The routing engine cannot be reached, timed out or answered with a server error. */
export class RoutingProviderUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'RoutingProviderUnavailableError';
  }
}

/** The configured engine has no data/profile for the requested transport mode. */
export class RoutingProfileNotSupportedError extends Error {
  constructor(
    public readonly profile: RoutingProfile,
    public readonly provider: string,
  ) {
    super(`Profile ${profile} is not supported by routing provider ${provider}`);
    this.name = 'RoutingProfileNotSupportedError';
  }
}

/** The request is invalid for the engine (e.g. distance limits exceeded). */
export class InvalidRouteRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidRouteRequestError';
  }
}
