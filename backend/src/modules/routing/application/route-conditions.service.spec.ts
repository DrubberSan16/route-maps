import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AppConfigService } from '../../../config/app-config.service';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { RouteResult } from '../domain/entities/route-result';
import { RouteConditionsService } from './route-conditions.service';

const ROUTE: RouteResult = {
  distanceMeters: 1000,
  durationSeconds: 100,
  geometry: {
    type: 'LineString',
    coordinates: [
      [-79.9, -2.2],
      [-79.89, -2.19],
    ],
  },
  steps: [],
  bbox: [-79.9, -2.2, -79.89, -2.19],
};

describe('RouteConditionsService', () => {
  let directory: string;

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'route-conditions-'));
    await writeFile(
      join(directory, 'climate-precipitation-regions.geojson'),
      JSON.stringify({
        type: 'FeatureCollection',
        features: [
          {
            id: 'rain-1',
            properties: { rango: '3000 - 3500', dhnom: 'Costa' },
            geometry: {
              type: 'Polygon',
              coordinates: [
                [
                  [-80, -2.3],
                  [-79.8, -2.3],
                  [-79.8, -2.1],
                  [-80, -2.1],
                  [-80, -2.3],
                ],
              ],
            },
          },
        ],
      }),
      'utf8',
    );
  });

  afterAll(async () => rm(directory, { recursive: true, force: true }));

  const service = (trafficRows: unknown[]) =>
    new RouteConditionsService(
      { $queryRaw: jest.fn().mockResolvedValue(trafficRows) } as unknown as PrismaService,
      {
        get: jest.fn().mockReturnValue({ nativeDataPath: directory }),
      } as unknown as AppConfigService,
    );

  it('keeps the base duration without enough traffic and reports local climatology', async () => {
    const conditions = await service([]).evaluate(ROUTE);

    expect(conditions.traffic.status).toBe('insufficient_data');
    expect(conditions.adjustedDurationSeconds).toBe(100);
    expect(conditions.climate.status).toBe('climatology');
    expect(conditions.climate.zones[0]).toMatchObject({ range: '3000 - 3500', district: 'Costa' });
    expect(conditions.climate.warnings).toHaveLength(1);
  });

  it('increases duration when observed traffic is slower than the route free-flow speed', async () => {
    const conditions = await service([
      {
        average_speed_kph: 18,
        samples: BigInt(9),
        trips: BigInt(3),
      },
    ]).evaluate(ROUTE);

    expect(conditions.traffic).toMatchObject({
      status: 'observed',
      averageSpeedKph: 18,
      sampleCount: 9,
      tripCount: 3,
      delaySeconds: 100,
    });
    expect(conditions.baseDurationSeconds).toBe(100);
    expect(conditions.adjustedDurationSeconds).toBe(200);
  });
});
