import { CalculateRouteInput, RouteCalculation } from '../entities/route-result';
import { RoutingProfile } from '../value-objects/routing-profile';

/**
 * Port implemented by each routing engine adapter (Valhalla, OSRM, ...).
 * Controllers and use cases only depend on this contract, so the engine can
 * be replaced by configuration (ROUTING_PROVIDER) without touching them.
 */
export interface RoutingProvider {
  readonly name: string;
  supportedProfiles(): RoutingProfile[];
  calculateRoute(input: CalculateRouteInput): Promise<RouteCalculation>;
  health(): Promise<'up' | 'down'>;
}

export const ROUTING_PROVIDER = Symbol('ROUTING_PROVIDER');
