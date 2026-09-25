import { Logger } from '@nestjs/common';
import { AppConfigService } from '../../../../config/app-config.service';
import { RoutingProvider } from '../../domain/interfaces/routing-provider';
import { OsrmRoutingProvider } from './osrm-routing.provider';
import { ValhallaRoutingProvider } from './valhalla-routing.provider';

/** Selects the routing engine adapter from ROUTING_PROVIDER. */
export function createRoutingProvider(config: AppConfigService): RoutingProvider {
  const routing = config.get('routing');
  const logger = new Logger('RoutingProviderFactory');
  switch (routing.provider) {
    case 'osrm': {
      const { carUrl, bicycleUrl, footUrl } = routing.osrm;
      logger.log('Using OSRM routing provider');
      return new OsrmRoutingProvider({
        urls: {
          ...(carUrl ? { CAR: carUrl } : {}),
          ...(bicycleUrl ? { BICYCLE: bicycleUrl } : {}),
          ...(footUrl ? { PEDESTRIAN: footUrl } : {}),
        },
        timeoutMs: routing.timeoutMs,
      });
    }
    case 'valhalla':
      logger.log(`Using Valhalla routing provider at ${routing.valhallaUrl}`);
      return new ValhallaRoutingProvider({
        baseUrl: routing.valhallaUrl,
        timeoutMs: routing.timeoutMs,
      });
    default:
      throw new Error(`Unknown ROUTING_PROVIDER "${String(routing.provider)}"`);
  }
}
