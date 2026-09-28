import { Logger } from '@nestjs/common';
import { AppConfigService } from '../../../../config/app-config.service';
import { NativeGraphStore } from '../../../../infrastructure/native/native-graph.store';
import { NativeRoutingProvider } from './native-routing.provider';
import { OsrmRoutingProvider } from './osrm-routing.provider';
import { createRoutingProvider } from './routing-provider.factory';
import { ValhallaRoutingProvider } from './valhalla-routing.provider';

describe('createRoutingProvider', () => {
  const configFor = (routing: Record<string, unknown>) =>
    ({
      get: () => ({ valhallaUrl: 'http://routing:8002', osrm: {}, timeoutMs: 1000, ...routing }),
    }) as unknown as AppConfigService;

  const graph = new NativeGraphStore('/data/native/ecuador/graph.bin');

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it('creates the Valhalla adapter by default configuration', () => {
    const provider = createRoutingProvider(configFor({ provider: 'valhalla' }), graph);
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
      graph,
    );
    expect(provider).toBeInstanceOf(OsrmRoutingProvider);
    expect(provider.supportedProfiles()).toEqual(['CAR', 'PEDESTRIAN']);
  });

  it('creates the native adapter on the shared road graph with every profile', () => {
    const provider = createRoutingProvider(configFor({ provider: 'native' }), graph);
    expect(provider).toBeInstanceOf(NativeRoutingProvider);
    expect(provider.supportedProfiles()).toEqual([
      'CAR',
      'TRUCK',
      'MOTORCYCLE',
      'BICYCLE',
      'PEDESTRIAN',
    ]);
  });

  it('fails fast on an unknown engine', () => {
    expect(() => createRoutingProvider(configFor({ provider: 'graphhopper' }), graph)).toThrow(
      'Unknown ROUTING_PROVIDER "graphhopper"',
    );
  });
});
