import { NativeGraph } from '../../../../infrastructure/native/native-graph';
import { NativeGraphStore } from '../../../../infrastructure/native/native-graph.store';
import { CalculateRouteInput, RouteCalculation } from '../../domain/entities/route-result';
import {
  RouteNotFoundError,
  RoutingProfileNotSupportedError,
  RoutingProviderUnavailableError,
} from '../../domain/errors';
import { RoutingProvider } from '../../domain/interfaces/routing-provider';
import { RoutingProfile } from '../../domain/value-objects/routing-profile';
import { NATIVE_PROFILES, NativeRouter, NoRouteError } from '../native/native-router';

/**
 * Routes in-process on the platform's own road graph (census streets + state roads), built by
 * the data pipeline. No external engine or service is involved at runtime.
 */
export class NativeRoutingProvider implements RoutingProvider {
  readonly name = 'native';
  private router: { graph: NativeGraph; router: NativeRouter } | null = null;

  constructor(private readonly store: NativeGraphStore) {}

  supportedProfiles(): RoutingProfile[] {
    return [...NATIVE_PROFILES];
  }

  async health(): Promise<'up' | 'down'> {
    return (await this.store.available()) ? 'up' : 'down';
  }

  dataVersion(): Promise<string> {
    return this.store.fingerprint();
  }

  async calculateRoute(input: CalculateRouteInput): Promise<RouteCalculation> {
    if (!NATIVE_PROFILES.includes(input.profile)) {
      throw new RoutingProfileNotSupportedError(input.profile, this.name);
    }
    let graph: NativeGraph;
    try {
      graph = await this.store.get();
    } catch (error) {
      throw new RoutingProviderUnavailableError('The road graph could not be loaded', {
        cause: error,
      });
    }
    if (this.router?.graph !== graph) this.router = { graph, router: new NativeRouter(graph) };
    const stops = [input.origin, ...(input.waypoints ?? []), input.destination];
    try {
      const { primary, alternatives } = this.router.router.route(
        input.profile,
        stops,
        input.waypoints?.length ? 0 : input.alternatives,
        { language: input.language },
      );
      return { primary, alternatives, provider: this.name };
    } catch (error) {
      if (error instanceof NoRouteError) throw new RouteNotFoundError(error.message);
      throw error;
    }
  }
}
