import { HttpStatus, Logger } from '@nestjs/common';
import { AppException } from '../../../common/errors/app.exception';
import { ErrorCode } from '../../../common/errors/error-codes';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { PlacesService } from '../../places/application/places.service';
import { DownloadedRegionsService } from '../../regions/application/downloaded-regions.service';
import { SavedRoutesService } from '../../routing/application/use-cases/saved-routes.service';
import { TrackingService } from '../../tracking/application/tracking.service';
import { TripsService } from '../../trips/application/trips.service';
import { UsersService } from '../../users/application/users.service';
import { SyncOperation } from '../domain/sync-operation';
import { SynchronizationService } from './synchronization.service';

const USER = 'a3f1c2d4-5b6e-4f70-8a9b-0c1d2e3f4a5b';
const TRIP = '7d9e2b1a-3c4d-4e5f-8a6b-9c0d1e2f3a4b';
const ROUTE = '1b2c3d4e-5f60-4a7b-8c9d-0e1f2a3b4c5d';

const op = (
  id: string,
  entity: SyncOperation['entity'],
  operation: SyncOperation['operation'],
  payload: Record<string, unknown>,
): SyncOperation => ({ id, entity, operation, payload });

const routePayload = {
  id: ROUTE,
  name: 'Casa → Oficina',
  profile: 'CAR',
  origin: { latitude: -2.1962, longitude: -79.8862 },
  destination: { latitude: -2.1894, longitude: -79.8975 },
  distanceMeters: 1850,
  durationSeconds: 300,
  geometry: {
    type: 'LineString',
    coordinates: [
      [-79.8862, -2.1962],
      [-79.8975, -2.1894],
    ],
  },
};

const point = (secondsAgo: number) => ({
  tripId: TRIP,
  latitude: -2.19,
  longitude: -79.89,
  accuracy: 5,
  timestamp: new Date(Date.now() - secondsAgo * 1000).toISOString(),
});

describe('SynchronizationService', () => {
  let prisma: {
    synchronizationEvent: { findMany: jest.Mock; upsert: jest.Mock };
    trip: { update: jest.Mock };
    place: { findFirst: jest.Mock };
  };
  let trips: { start: jest.Mock; finish: jest.Mock; cancel: jest.Mock };
  let tracking: { recordBatch: jest.Mock };
  let routes: { save: jest.Mock; delete: jest.Mock; changes: jest.Mock };
  let downloadedRegions: { record: jest.Mock };
  let service: SynchronizationService;

  const recorded = () =>
    prisma.synchronizationEvent.upsert.mock.calls.map(
      ([args]: [{ create: { clientOperationId: string; status: string; errorCode: string } }]) => [
        args.create.clientOperationId,
        args.create.status,
        args.create.errorCode,
      ],
    );

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    prisma = {
      synchronizationEvent: {
        findMany: jest.fn().mockResolvedValue([]),
        upsert: jest.fn().mockResolvedValue({}),
      },
      trip: { update: jest.fn().mockResolvedValue({}) },
      place: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    trips = {
      start: jest.fn().mockResolvedValue({ id: TRIP, deviceId: null }),
      finish: jest.fn().mockResolvedValue({ id: TRIP, distanceMeters: 1234 }),
      cancel: jest.fn().mockResolvedValue({}),
    };
    tracking = { recordBatch: jest.fn().mockResolvedValue({ accepted: 2, duplicates: 0 }) };
    routes = {
      save: jest.fn().mockResolvedValue({ id: ROUTE }),
      delete: jest.fn().mockResolvedValue({ deleted: true }),
      changes: jest.fn(),
    };
    downloadedRegions = { record: jest.fn().mockResolvedValue({}) };
    const users = { registerDevice: jest.fn().mockResolvedValue({ id: 'device-1' }) };
    service = new SynchronizationService(
      prisma as unknown as PrismaService,
      users as unknown as UsersService,
      trips as unknown as TripsService,
      tracking as unknown as TrackingService,
      routes as unknown as SavedRoutesService,
      {} as PlacesService,
      downloadedRegions as unknown as DownloadedRegionsService,
    );
  });

  afterEach(() => jest.restoreAllMocks());

  it('applies a queued offline session in order: trip, points, finish and saved route', async () => {
    const { results } = await service.push(USER, 'pixel-8-install-01', [
      op('op-1', 'trip', 'CREATE', { id: TRIP, profile: 'CAR', startedAt: point(120).timestamp }),
      op('op-2', 'tracking_point', 'CREATE', { points: [point(90), point(30)] }),
      op('op-3', 'trip', 'FINISH', { id: TRIP }),
      op('op-4', 'route', 'UPSERT', routePayload),
    ]);

    expect(results.map((result) => [result.id, result.status])).toEqual([
      ['op-1', 'APPLIED'],
      ['op-2', 'APPLIED'],
      ['op-3', 'APPLIED'],
      ['op-4', 'APPLIED'],
    ]);
    expect(results[0].result).toEqual({ tripId: TRIP });
    expect(trips.start).toHaveBeenCalledWith(
      USER,
      expect.objectContaining({ id: TRIP, startedAt: expect.any(Date) }),
    );
    // The trip is attached to the device that recorded it.
    expect(prisma.trip.update).toHaveBeenCalledWith({
      where: { id: TRIP },
      data: { deviceId: 'device-1' },
    });
    expect(tracking.recordBatch).toHaveBeenCalledWith(USER, [
      expect.objectContaining({ tripId: TRIP, latitude: -2.19 }),
      expect.objectContaining({ tripId: TRIP, latitude: -2.19 }),
    ]);
    expect(routes.save).toHaveBeenCalledWith(
      USER,
      expect.objectContaining({ id: ROUTE, steps: [] }),
    );
    expect(recorded()).toEqual([
      ['op-1', 'APPLIED', null],
      ['op-2', 'APPLIED', null],
      ['op-3', 'APPLIED', null],
      ['op-4', 'APPLIED', null],
    ]);
  });

  it('is idempotent: operations already applied are reported as DUPLICATE', async () => {
    prisma.synchronizationEvent.findMany.mockResolvedValue([
      { clientOperationId: 'op-1', status: 'APPLIED' },
    ]);

    const { results } = await service.push(USER, undefined, [
      op('op-1', 'route', 'DELETE', { id: ROUTE }),
      op('op-2', 'route', 'DELETE', { id: ROUTE }),
      op('op-2', 'route', 'DELETE', { id: ROUTE }),
    ]);

    expect(results.map((result) => result.status)).toEqual(['DUPLICATE', 'APPLIED', 'DUPLICATE']);
    expect(routes.delete).toHaveBeenCalledTimes(1);
  });

  it('retries operations whose previous attempt failed', async () => {
    prisma.synchronizationEvent.findMany.mockResolvedValue([
      { clientOperationId: 'op-1', status: 'FAILED' },
    ]);

    const { results } = await service.push(USER, undefined, [
      op('op-1', 'route', 'DELETE', { id: ROUTE }),
    ]);

    expect(results[0].status).toBe('APPLIED');
  });

  it('rejects invalid payloads permanently with the validation details', async () => {
    const { results } = await service.push(USER, undefined, [
      op('op-1', 'route', 'CREATE', { ...routePayload, profile: 'SPACESHIP', unknownField: 1 }),
    ]);

    expect(results[0]).toMatchObject({
      status: 'FAILED',
      retryable: false,
      error: { code: ErrorCode.VALIDATION_ERROR, message: 'Invalid operation payload' },
    });
    expect(results[0].error?.details).toEqual(
      expect.arrayContaining([expect.stringContaining('profile must be one of')]),
    );
    expect(recorded()).toEqual([['op-1', 'FAILED', ErrorCode.VALIDATION_ERROR]]);
    expect(routes.save).not.toHaveBeenCalled();
  });

  it('checks every step of a route, so the app can always read it back', async () => {
    const step = {
      instruction: 'Conduzca hacia el noroeste',
      distanceMeters: 1850,
      durationSeconds: 300,
      maneuver: 'DEPART',
      location: [-79.8862, -2.1962],
      streetNames: ['Malecón Simón Bolívar'],
      geometryIndex: [0, 1],
    };

    const { results } = await service.push(USER, undefined, [
      op('op-1', 'route', 'UPSERT', { ...routePayload, steps: [step] }),
      op('op-2', 'route', 'UPSERT', {
        ...routePayload,
        steps: [step, { ...step, instruction: 42, location: [-79.88], geometryIndex: [0, -1] }],
      }),
      op('op-3', 'route', 'UPSERT', { ...routePayload, steps: [null] }),
    ]);

    expect(results.map((result) => result.status)).toEqual(['APPLIED', 'FAILED', 'FAILED']);
    expect(routes.save).toHaveBeenCalledTimes(1);
    expect(routes.save).toHaveBeenCalledWith(USER, expect.objectContaining({ steps: [step] }));
    expect(results[1]).toMatchObject({ retryable: false, error: { code: 'VALIDATION_ERROR' } });
    expect(results[1].error?.details).toEqual([
      'steps.1.instruction must be shorter than or equal to 500 characters',
      'steps.1.instruction must be a string',
      'steps.1.location must be a [longitude, latitude] position',
      'steps.1.each value in geometryIndex must not be less than 0',
    ]);
    expect(results[2].error?.details).toEqual([
      'steps.each value in nested property steps must be either object or array',
    ]);
  });

  it('rejects a tracking batch with an invalid point', async () => {
    const { results } = await service.push(USER, undefined, [
      op('op-1', 'tracking_point', 'CREATE', {
        points: [point(10), { ...point(5), latitude: 95 }],
      }),
    ]);

    expect(results[0]).toMatchObject({ status: 'FAILED', retryable: false });
    expect(tracking.recordBatch).not.toHaveBeenCalled();
  });

  it('reports unsupported entity/operation pairs as permanent failures', async () => {
    const { results } = await service.push(USER, undefined, [
      op('op-1', 'trip', 'DELETE', { id: TRIP }),
    ]);

    expect(results[0]).toMatchObject({
      status: 'FAILED',
      retryable: false,
      error: { code: ErrorCode.SYNC_OPERATION_NOT_SUPPORTED },
    });
  });

  it('keeps business errors (4xx) as permanent and server errors (5xx) as retryable', async () => {
    trips.finish
      .mockRejectedValueOnce(AppException.notFound(ErrorCode.TRIP_NOT_FOUND, 'Trip not found'))
      .mockRejectedValueOnce(
        new AppException(ErrorCode.INTERNAL_ERROR, 'Database busy', HttpStatus.SERVICE_UNAVAILABLE),
      );

    const { results } = await service.push(USER, undefined, [
      op('op-1', 'trip', 'FINISH', { id: TRIP }),
      op('op-2', 'trip', 'FINISH', { id: TRIP }),
    ]);

    expect(results.map((result) => [result.status, result.retryable])).toEqual([
      ['FAILED', false],
      ['FAILED', true],
    ]);
    // Only the permanent failure is recorded; the retryable one will be pushed again.
    expect(recorded()).toEqual([['op-1', 'FAILED', ErrorCode.TRIP_NOT_FOUND]]);
  });

  it('treats unexpected errors as retryable without leaking details', async () => {
    tracking.recordBatch.mockRejectedValueOnce(new Error('connection reset by peer'));

    const { results } = await service.push(USER, undefined, [
      op('op-1', 'tracking_point', 'CREATE', point(10)),
    ]);

    expect(results[0]).toEqual({
      id: 'op-1',
      status: 'FAILED',
      retryable: true,
      error: { code: ErrorCode.INTERNAL_ERROR, message: 'Temporary server error' },
    });
    expect(recorded()).toEqual([]);
  });

  describe('pull', () => {
    const changedAt = new Date('2026-09-25T18:30:00.123Z');

    it('starts at the beginning of the feed and returns the cursor of the last change', async () => {
      routes.changes.mockResolvedValue({
        routes: [{ id: ROUTE }],
        deletedIds: [TRIP],
        next: { changedAt, id: TRIP },
        hasMore: true,
      });

      const result = await service.pull(USER);

      expect(routes.changes).toHaveBeenCalledWith(
        USER,
        { changedAt: new Date(0), id: '00000000-0000-0000-0000-000000000000' },
        200,
      );
      expect(result).toEqual({
        serverTime: expect.any(Date),
        routes: [{ id: ROUTE }],
        deletedRouteIds: [TRIP],
        hasMore: true,
        next: { since: changedAt, afterId: TRIP },
      });
    });

    it('continues after the given (since, afterId) cursor', async () => {
      routes.changes.mockResolvedValue({ routes: [], deletedIds: [], next: null, hasMore: false });

      const result = await service.pull(USER, { since: changedAt, afterId: ROUTE }, 50);

      expect(routes.changes).toHaveBeenCalledWith(USER, { changedAt, id: ROUTE }, 50);
      expect(result).toMatchObject({ routes: [], deletedRouteIds: [], hasMore: false, next: null });
    });
  });

  it('requires an installation id to record downloaded regions', async () => {
    const payload = { regionId: 'guayaquil', version: '2026.09.25.1830' };

    const anonymous = await service.push(USER, undefined, [
      op('op-1', 'downloaded_region', 'UPSERT', payload),
    ]);
    const withDevice = await service.push(USER, 'pixel-8-install-01', [
      op('op-2', 'downloaded_region', 'DELETE', payload),
    ]);

    expect(anonymous.results[0]).toMatchObject({ status: 'FAILED', retryable: false });
    expect(withDevice.results[0].status).toBe('APPLIED');
    expect(downloadedRegions.record).toHaveBeenCalledWith({
      userId: USER,
      deviceId: 'device-1',
      regionCode: 'guayaquil',
      version: '2026.09.25.1830',
      status: 'DELETED',
    });
  });
});
