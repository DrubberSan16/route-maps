import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { haversineMeters, Position, toPosition } from '../src/common/geo/geojson';
import { MapRegionService } from '../src/modules/regions/application/map-region.service';
import {
  bboxOf,
  CalculateRouteInput,
  RouteCalculation,
} from '../src/modules/routing/domain/entities/route-result';
import {
  ROUTING_PROVIDER,
  RoutingProvider,
} from '../src/modules/routing/domain/interfaces/routing-provider';
import { ROUTING_PROFILES } from '../src/modules/routing/domain/value-objects/routing-profile';

/** Deterministic engine: a straight line between the stops. */
class StraightLineRouting implements RoutingProvider {
  readonly name = 'e2e-straight-line';

  supportedProfiles() {
    return [...ROUTING_PROFILES];
  }

  calculateRoute(input: CalculateRouteInput): Promise<RouteCalculation> {
    const stops = [input.origin, ...(input.waypoints ?? []), input.destination];
    const coordinates: Position[] = stops.map(toPosition);
    let distance = 0;
    for (let i = 1; i < stops.length; i++) distance += haversineMeters(stops[i - 1], stops[i]);
    const last = coordinates.length - 1;
    return Promise.resolve({
      primary: {
        distanceMeters: Math.round(distance),
        durationSeconds: Math.round(distance / 10),
        geometry: { type: 'LineString', coordinates },
        steps: [
          {
            instruction: 'Conduzca hacia el noroeste',
            distanceMeters: Math.round(distance),
            durationSeconds: Math.round(distance / 10),
            maneuver: 'DEPART',
            location: coordinates[0],
            streetNames: [],
            geometryIndex: [0, last],
          },
          {
            instruction: 'Ha llegado a su destino',
            distanceMeters: 0,
            durationSeconds: 0,
            maneuver: 'ARRIVE',
            location: coordinates[last],
            streetNames: [],
            geometryIndex: [last, last],
          },
        ],
        bbox: bboxOf(coordinates),
      },
      alternatives: [],
      provider: this.name,
    });
  }

  health() {
    return Promise.resolve('up' as const);
  }
}

const REGION = 'e2e-guayaquil';
// Deterministic content: the region keeps the same checksum across runs.
const MAP_BYTES = Buffer.concat([Buffer.from('PMTiles'), Buffer.alloc(96 * 1024, 'e2e-tiles')]);
const ROUTING_BYTES = Buffer.alloc(32 * 1024, 'e2e-valhalla-tiles');
const sha256 = (data: Buffer) => createHash('sha256').update(data).digest('hex');

// Guayaquil: Malecón 2000 -> Parque Seminario.
const ORIGIN = { latitude: -2.1962, longitude: -79.8862 };
const DESTINATION = { latitude: -2.1894, longitude: -79.8975 };

const binary = (res: request.Response, callback: (error: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on('data', (chunk: Buffer) => chunks.push(chunk));
  res.on('end', () => callback(null, Buffer.concat(chunks)));
};

describe('Maps Platform API (e2e)', () => {
  let app: NestExpressApplication;
  let http: App;
  let accessToken: string;
  let refreshToken: string;
  const email = `e2e-${Date.now()}-${Math.round(Math.random() * 1e6)}@example.com`;
  const password = 'E2e-Strong-Password-2026';

  const api = (method: 'get' | 'post' | 'patch' | 'delete' | 'head', path: string) => {
    const req = request(http)[method](`/api/v1${path}`);
    return accessToken ? req.set('Authorization', `Bearer ${accessToken}`) : req;
  };

  beforeAll(async () => {
    const storage = process.env.E2E_STORAGE_PATH!;
    const put = async (path: string, data: Buffer | string) => {
      await mkdir(dirname(join(storage, path)), { recursive: true });
      await writeFile(join(storage, path), data);
    };
    await put(`maps/ecuador/${REGION}.pmtiles`, MAP_BYTES);
    await put(`routing/${REGION}/${REGION}.valhalla.tar`, ROUTING_BYTES);
    await put(
      `maps/ecuador/${REGION}.region.json`,
      JSON.stringify({
        code: REGION,
        name: 'Guayaquil (e2e)',
        country: 'EC',
        province: 'Guayas',
        city: 'Guayaquil',
        version: '2026.09.25.1830',
        bbox: [-80.1, -2.35, -79.75, -1.95],
        minZoom: 0,
        maxZoom: 14,
        mapFile: `ecuador/${REGION}.pmtiles`,
        routingFile: `${REGION}/${REGION}.valhalla.tar`,
      }),
    );

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ROUTING_PROVIDER)
      .useValue(new StraightLineRouting())
      .compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ bufferLogs: true });
    configureApp(app);
    await app.init();
    http = app.getHttpServer();
    const sync = await app.get(MapRegionService).syncFromStorage();
    if (sync.errors.length > 0)
      throw new Error(`Region sync failed: ${JSON.stringify(sync.errors)}`);
  });

  afterAll(async () => {
    await app?.close();
    await rm(process.env.E2E_STORAGE_PATH!, { recursive: true, force: true });
  });

  describe('health', () => {
    it('GET /health/live answers without touching dependencies', async () => {
      const res = await request(http).get('/health/live').expect(200);
      expect(res.body).toMatchObject({ status: 'ok' });
    });

    it('GET /health reports the database through PostGIS', async () => {
      const res = await request(http).get('/health').expect(200);
      expect(res.body).toMatchObject({
        status: 'ok',
        services: { database: 'up', routing: 'up', redis: 'disabled', geocoding: 'disabled' },
      });
    });
  });

  describe('auth', () => {
    it('registers, logs in and returns the profile', async () => {
      const registered = await api('post', '/auth/register')
        .send({ email, password, name: 'E2E' })
        .expect(201);
      expect(registered.body).toMatchObject({
        success: true,
        data: { user: { email }, tokenType: 'Bearer' },
      });
      expect(registered.body.data.user).not.toHaveProperty('passwordHash');

      await api('post', '/auth/register')
        .send({ email, password, name: 'E2E' })
        .expect(409)
        .expect(({ body }) => expect(body.error.code).toBe('EMAIL_ALREADY_REGISTERED'));
      await api('post', '/auth/login')
        .send({ email, password: 'wrong-password' })
        .expect(401)
        .expect(({ body }) => expect(body.error.code).toBe('INVALID_CREDENTIALS'));

      const login = await api('post', '/auth/login').send({ email, password }).expect(200);
      accessToken = login.body.data.accessToken;
      refreshToken = login.body.data.refreshToken;

      const me = await api('get', '/auth/me').expect(200);
      expect(me.body.data.email).toBe(email);
    });

    it('rejects protected endpoints without a token', async () => {
      await request(http)
        .get('/api/v1/auth/me')
        .expect(401)
        .expect(({ body }) =>
          expect(body).toEqual({
            success: false,
            error: expect.objectContaining({ code: 'UNAUTHORIZED' }),
          }),
        );
    });

    it('rotates refresh tokens and detects re-use', async () => {
      const rotated = await api('post', '/auth/refresh').send({ refreshToken }).expect(200);
      await api('post', '/auth/refresh').send({ refreshToken }).expect(401);
      // Re-use revoked the whole family, including the token just issued.
      await api('post', '/auth/refresh')
        .send({ refreshToken: rotated.body.data.refreshToken })
        .expect(401);

      const login = await api('post', '/auth/login').send({ email, password }).expect(200);
      accessToken = login.body.data.accessToken;
      refreshToken = login.body.data.refreshToken;
    });

    it('validates the payload', async () => {
      const res = await request(http)
        .post('/api/v1/auth/register')
        .send({ email: 'not-an-email', password: 'x', isAdmin: true })
        .expect(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.details).toEqual(
        expect.arrayContaining(['property isAdmin should not exist']),
      );
    });
  });

  describe('offline map regions', () => {
    it('lists the prepared region with its checksums and URLs', async () => {
      const res = await api('get', '/maps/regions').expect(200);
      const region = (res.body.data as { id: string }[]).find((item) => item.id === REGION);
      expect(region).toMatchObject({
        id: REGION,
        name: 'Guayaquil (e2e)',
        version: '2026.09.25.1830',
        checksum: sha256(MAP_BYTES),
        mapSize: MAP_BYTES.length,
        mapDownloadUrl: `/api/v1/maps/regions/${REGION}/download`,
        routingChecksum: sha256(ROUTING_BYTES),
        bbox: [-80.1, -2.35, -79.75, -1.95],
      });
    });

    it('locates the region covering a GPS position (PostGIS)', async () => {
      const inside = await api(
        'get',
        `/maps/regions/locate?lat=${ORIGIN.latitude}&lng=${ORIGIN.longitude}`,
      ).expect(200);
      expect((inside.body.data as { id: string }[]).map((item) => item.id)).toContain(REGION);

      const quito = await api('get', '/maps/regions/locate?lat=-0.1807&lng=-78.4678').expect(200);
      expect((quito.body.data as { id: string }[]).map((item) => item.id)).not.toContain(REGION);
    });

    it('tells the device whether an update is available', async () => {
      const old = await api(
        'get',
        `/maps/regions/${REGION}/version?localVersion=2026.01.01.0000`,
      ).expect(200);
      expect(old.body.data).toMatchObject({
        updateAvailable: true,
        latestVersion: '2026.09.25.1830',
      });

      const batch = await api('post', '/maps/regions/updates')
        .send({ regions: [{ id: REGION, version: '2026.09.25.1830' }] })
        .expect(200);
      expect(batch.body.data).toEqual([
        expect.objectContaining({ region: REGION, updateAvailable: false }),
      ]);
    });

    it('serves resumable downloads whose SHA-256 matches the catalog', async () => {
      const half = Math.floor(MAP_BYTES.length / 2);
      const first = await api('get', `/maps/regions/${REGION}/download`)
        .set('Range', `bytes=0-${half - 1}`)
        .parse(binary)
        .expect(206);
      const rest = await api('get', `/maps/regions/${REGION}/download`)
        .set('Range', `bytes=${half}-`)
        .parse(binary)
        .expect(206);

      expect(rest.headers['content-range']).toBe(
        `bytes ${half}-${MAP_BYTES.length - 1}/${MAP_BYTES.length}`,
      );
      expect(rest.headers['x-checksum-sha256']).toBe(sha256(MAP_BYTES));
      expect(sha256(Buffer.concat([first.body as Buffer, rest.body as Buffer]))).toBe(
        sha256(MAP_BYTES),
      );
    });

    it('serves the routing package for offline stored routes', async () => {
      const res = await api('get', `/maps/regions/${REGION}/routing/download`)
        .parse(binary)
        .expect(200);
      expect(res.headers['content-type']).toBe('application/x-tar');
      expect(sha256(res.body as Buffer)).toBe(sha256(ROUTING_BYTES));
    });

    it('answers MAP_REGION_NOT_FOUND for unknown regions', async () => {
      const res = await api('get', '/maps/regions/atlantis').expect(404);
      expect(res.body.error.code).toBe('MAP_REGION_NOT_FOUND');
    });
  });

  describe('routing', () => {
    let calculated: Record<string, unknown>;

    it('calculates a route for every profile', async () => {
      for (const profile of ROUTING_PROFILES) {
        const res = await api('post', '/routes/calculate')
          .send({ origin: ORIGIN, destination: DESTINATION, profile })
          .expect(200);
        expect(res.body.data).toMatchObject({
          profile,
          provider: 'e2e-straight-line',
          geometry: { type: 'LineString' },
          routes: [expect.objectContaining({ type: 'PRIMARY' })],
        });
        calculated = res.body.data;
      }
      expect(calculated.distanceMeters).toBeGreaterThan(1400);
    });

    it('validates coordinates and profiles', async () => {
      await api('post', '/routes/calculate')
        .send({ origin: { latitude: 95, longitude: 0 }, destination: DESTINATION })
        .expect(400);
      const res = await api('post', '/routes/calculate')
        .send({ origin: ORIGIN, destination: DESTINATION, profile: 'PLANE' })
        .expect(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('saves a route for offline use and returns it with its geometry', async () => {
      const saved = await api('post', '/routes')
        .send({
          name: 'Malecón → Parque Seminario',
          profile: 'CAR',
          origin: ORIGIN,
          destination: DESTINATION,
          distanceMeters: calculated.distanceMeters,
          durationSeconds: calculated.durationSeconds,
          geometry: calculated.geometry,
          steps: calculated.steps,
          regionCode: REGION,
          provider: 'valhalla',
        })
        .expect(201);
      const id = saved.body.data.id as string;

      const fetched = await api('get', `/routes/${id}`).expect(200);
      expect(fetched.body.data).toMatchObject({
        id,
        geometry: calculated.geometry,
        steps: calculated.steps,
      });
      const list = await api('get', '/routes').expect(200);
      expect(JSON.stringify(list.body.data)).toContain(id);
    });
  });

  describe('geofences', () => {
    it('checks whether a point is inside a circular geofence (PostGIS)', async () => {
      await api('post', '/geofences')
        .send({ name: 'Malecón 2000', type: 'CIRCLE', center: ORIGIN, radiusMeters: 500 })
        .expect(201);

      const inside = await api(
        'get',
        `/geofences/check?lat=${ORIGIN.latitude + 0.001}&lng=${ORIGIN.longitude}`,
      ).expect(200);
      expect(inside.body.data.inside).toEqual([expect.objectContaining({ name: 'Malecón 2000' })]);

      const outside = await api(
        'get',
        `/geofences/check?lat=${DESTINATION.latitude}&lng=${DESTINATION.longitude}`,
      ).expect(200);
      expect(outside.body.data.inside).toEqual([]);
    });
  });

  describe('trips, tracking and offline sync', () => {
    const ago = (seconds: number) => new Date(Date.now() - seconds * 1000).toISOString();

    it('records a live trip', async () => {
      const trip = await api('post', '/trips')
        .send({ profile: 'CAR', name: 'E2E trip' })
        .expect(201);
      await api('post', '/tracking/location')
        .send({ tripId: trip.body.data.id, ...ORIGIN, accuracy: 8.4, timestamp: ago(5) })
        .expect(201);
    });

    it('applies a session recorded offline once, even when the push is retried', async () => {
      const tripId = randomUUID();
      const push = {
        installationId: `e2e-device-${Date.now()}`,
        operations: [
          {
            id: `op-${randomUUID()}`,
            entity: 'trip',
            operation: 'CREATE',
            payload: { id: tripId, profile: 'CAR', startedAt: ago(120) },
          },
          {
            id: `op-${randomUUID()}`,
            entity: 'tracking_point',
            operation: 'CREATE',
            payload: {
              points: [
                { tripId, ...ORIGIN, accuracy: 5, timestamp: ago(90) },
                { tripId, ...DESTINATION, accuracy: 5, timestamp: ago(30) },
              ],
            },
          },
          {
            id: `op-${randomUUID()}`,
            entity: 'trip',
            operation: 'FINISH',
            payload: { id: tripId },
          },
        ],
      };

      const statuses = (res: request.Response) =>
        (res.body as { data: { results: { status: string }[] } }).data.results.map(
          (result) => result.status,
        );
      const first = await api('post', '/sync/push').send(push).expect(200);
      expect(statuses(first)).toEqual(['APPLIED', 'APPLIED', 'APPLIED']);
      const retry = await api('post', '/sync/push').send(push).expect(200);
      expect(statuses(retry)).toEqual(['DUPLICATE', 'DUPLICATE', 'DUPLICATE']);

      const trip = await api('get', `/trips/${tripId}`).expect(200);
      expect(trip.body.data).toMatchObject({ status: 'COMPLETED', pointCount: 2 });
      // PostGIS length of the recorded track (~1.5 km).
      expect(trip.body.data.distanceMeters).toBeGreaterThan(1400);
      expect(trip.body.data.distanceMeters).toBeLessThan(1600);
    });

    it('pulls the routes saved from other devices', async () => {
      const res = await api('get', '/sync/pull?since=2000-01-01T00:00:00.000Z').expect(200);
      expect(res.body.data.routes.length).toBeGreaterThanOrEqual(1);
      expect(res.body.data).toHaveProperty('serverTime');
    });
  });

  describe('geocoding and documentation', () => {
    it('reports geocoding as unavailable while Nominatim is disabled', async () => {
      const res = await api('get', '/geocoding/search?q=hospital').expect(503);
      expect(res.body.error.code).toBe('GEOCODING_PROVIDER_UNAVAILABLE');
    });

    it('publishes the OpenAPI document', async () => {
      const res = await request(http).get('/api/docs-json').expect(200);
      expect(Object.keys(res.body.paths as object)).toEqual(
        expect.arrayContaining([
          '/api/v1/routes/calculate',
          '/api/v1/maps/regions',
          '/api/v1/sync/push',
        ]),
      );
    });
  });

  it('logs out and invalidates the refresh token', async () => {
    await api('post', '/auth/logout').send({ refreshToken }).expect(200);
    await api('post', '/auth/refresh').send({ refreshToken }).expect(401);
  });
});
