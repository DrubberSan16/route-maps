import { Logger } from '@nestjs/common';
import { AppConfigService } from '../../../config/app-config.service';
import type { CacheProvider } from '../../../infrastructure/cache/cache.provider';
import type { NativeGraphStore } from '../../../infrastructure/native/native-graph.store';
import { fixtureGraph } from '../../../infrastructure/native/testing/graph-fixture';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { TrafficService, trafficStatus } from './traffic.service';

// Two parallel avenues in Guayaquil, ~500 m long and ~550 m apart.
const GRAPH = fixtureGraph({
  nodes: [
    [-79.9, -2.19],
    [-79.895, -2.19],
    [-79.9, -2.185],
    [-79.895, -2.185],
  ],
  edges: [
    { u: 0, v: 1, cls: 'primary', name: 'Avenida Sur' },
    { u: 2, v: 3, cls: 'primary', name: 'Avenida Norte' },
  ],
});

type Fix = { lon: number; lat: number; speed: number; trip_id: string };

const fixes = (lat: number, trips: string[], speed: number, perTrip = 2): Fix[] =>
  trips.flatMap((trip) =>
    Array.from({ length: perTrip }, (_, i) => ({
      lon: -79.899 + i * 0.001,
      lat,
      speed,
      trip_id: trip,
    })),
  );

class MemoryCache implements CacheProvider {
  readonly values = new Map<string, unknown>();
  get<T>(key: string) {
    return Promise.resolve(this.values.get(key) as T | undefined);
  }
  set<T>(key: string, value: T) {
    this.values.set(key, value);
    return Promise.resolve();
  }
  delete(key: string) {
    this.values.delete(key);
    return Promise.resolve();
  }
  status() {
    return Promise.resolve('up' as const);
  }
}

describe('TrafficService', () => {
  const BBOX: [number, number, number, number] = [-79.91, -2.2, -79.89, -2.18];
  let live: Fix[];
  let typical: Fix[];
  let queries: string[];
  let cache: MemoryCache;
  let service: TrafficService;

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
    live = [];
    typical = [];
    queries = [];
    cache = new MemoryCache();
    const prisma = {
      $queryRaw: jest.fn((strings: TemplateStringsArray) => {
        const sql = strings.join('?');
        const isTypical = sql.includes('isodow');
        queries.push(isTypical ? 'typical' : 'live');
        return Promise.resolve(isTypical ? typical : live);
      }),
    } as unknown as PrismaService;
    const graphs = { get: () => Promise.resolve(GRAPH) } as unknown as NativeGraphStore;
    const config = {
      get: () => ({ timeZone: 'America/Guayaquil' }),
    } as unknown as AppConfigService;
    service = new TrafficService(prisma, graphs, cache, config);
  });

  afterEach(() => jest.restoreAllMocks());

  it('colours a segment with live speeds from two different trips', async () => {
    live = fixes(-2.19, ['a', 'b'], 2); // 7 km/h on a primary avenue

    const flow = await service.flow(BBOX);

    expect(flow.features).toHaveLength(1);
    expect(flow.features[0].properties).toMatchObject({
      source: 'live',
      status: 'jammed',
      speedKph: 7,
      trips: 2,
      samples: 4,
    });
    expect(flow.features[0].geometry.coordinates[0]).toEqual([-79.9, -2.19]);
  });

  it('says nothing about a segment with a single trip (privacy and noise)', async () => {
    live = fixes(-2.19, ['a'], 2, 5);
    typical = fixes(-2.185, ['x', 'y'], 12, 3);

    const flow = await service.flow(BBOX);

    expect(flow.features).toEqual([]);
  });

  it('fills segments without live data with typical traffic, never overriding live data', async () => {
    live = fixes(-2.19, ['a', 'b'], 12);
    // 32 km/h on a 55 km/h avenue: moderate. The jammed history of the south avenue is ignored.
    typical = [...fixes(-2.185, ['x', 'y', 'z'], 9), ...fixes(-2.19, ['x', 'y', 'z'], 1)];

    const flow = await service.flow(BBOX);

    const bySource = Object.fromEntries(
      flow.features.map((feature) => [feature.properties.source, feature.properties]),
    );
    expect(Object.keys(bySource).sort()).toEqual(['live', 'typical']);
    expect(bySource.live).toMatchObject({ status: 'free', trips: 2 });
    expect(bySource.typical).toMatchObject({ status: 'moderate', trips: 3 });
    expect(flow.typicalWindowDays).toBe(28);
  });

  it('computes typical traffic once per hour and live traffic once per minute', async () => {
    typical = fixes(-2.185, ['x', 'y', 'z'], 12);

    await service.flow(BBOX);
    cache.values.delete([...cache.values.keys()].find((key) => key.includes(':flow:'))!);
    await service.flow(BBOX);

    expect(queries).toEqual(['live', 'typical', 'live']);
  });

  it('maps speed ratios to the four colours', () => {
    expect([1, 0.75, 0.6, 0.3, 0.1].map(trafficStatus)).toEqual([
      'free',
      'free',
      'moderate',
      'slow',
      'jammed',
    ]);
  });
});
