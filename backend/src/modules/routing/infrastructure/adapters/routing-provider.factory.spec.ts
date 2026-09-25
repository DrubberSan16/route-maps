import { Logger } from '@nestjs/common';
import { AppConfigService } from '../../../../config/app-config.service';
import { OsrmRoutingProvider } from './osrm-routing.provider';
import { createRoutingProvider } from './routing-provider.factory';
import { ValhallaRoutingProvider } from './valhalla-routing.provider';

describe('createRoutingProvider', () => {
  const configFor = (routing: Record<string, unknown>) =>
    ({
      get: () => ({ valhallaUrl: 'http://routing:8002', osrm: {}, timeoutMs: 1000, ...routing }),
    }) as unknown as AppConfigService;

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it('creates the Valhalla adapter by default configuration', () => {
    const provider = createRoutingProvider(configFor({ provider: 'valhalla' }));
    expect(provider).toBeInstanceOf(ValhallaRoutingProvider);
    expect(provider.supportedProfiles()).toEqual([
      'CAR',
      'TRUCK',
      'MOTORCYCLE',
      'BICYCLE',
      'PEDESTRIAN',
    ]);
  });

  it('creates the OSRM adapter with one instance per configured profile', () => {
    const provider = createRoutingProvider(
      configFor({
        provider: 'osrm',
        osrm: { carUrl: 'http://osrm-car:5000', footUrl: 'http://osrm-foot:5000' },
      }),
    );
    expect(provider).toBeInstanceOf(OsrmRoutingProvider);
    expect(provider.supportedProfiles()).toEqual(['CAR', 'PEDESTRIAN']);
  });

  it('fails fast on an unknown engine', () => {
    expect(() => createRoutingProvider(configFor({ provider: 'graphhopper' }))).toThrow(
      'Unknown ROUTING_PROVIDER "graphhopper"',
    );
  });
});
