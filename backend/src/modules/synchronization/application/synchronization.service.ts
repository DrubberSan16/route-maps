import { Injectable, Logger } from '@nestjs/common';
import { ArrayMaxSize, IsArray, IsIn, IsOptional, IsString, IsUUID, Length } from 'class-validator';
import { Prisma } from '../../../generated/prisma/client';
import { AppException } from '../../../common/errors/app.exception';
import { ErrorCode } from '../../../common/errors/error-codes';
import { DownloadedRegionStatus, SyncEventStatus } from '../../../generated/prisma/enums';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { CreatePlaceDto } from '../../places/application/dto/place.dto';
import { PlacesService } from '../../places/application/places.service';
import { DownloadedRegionsService } from '../../regions/application/downloaded-regions.service';
import { SaveRouteDto } from '../../routing/application/dto/calculate-route.dto';
import { SavedRoutesService } from '../../routing/application/use-cases/saved-routes.service';
import { SavedRoute } from '../../routing/domain/entities/saved-route';
import { TrackLocationDto, toLocationPoint } from '../../tracking/application/dto/tracking.dto';
import { TrackingService } from '../../tracking/application/tracking.service';
import { FinishTripDto, StartTripDto } from '../../trips/application/dto/trip.dto';
import { TripsService } from '../../trips/application/trips.service';
import { UsersService } from '../../users/application/users.service';
import { SyncOperation, SyncOperationResult, SyncValidationError } from '../domain/sync-operation';
import { parsePayload } from './sync-handlers';

class EntityIdPayload {
  @IsUUID()
  id: string;
}

class FinishTripPayload extends FinishTripDto {
  @IsUUID()
  id: string;
}

class TrackingBatchPayload {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(1000)
  points?: unknown[];
}

class DownloadedRegionPayload {
  @IsString()
  @Length(1, 64)
  regionId: string;

  @IsString()
  @Length(1, 40)
  version: string;

  @IsOptional()
  @IsIn(['DOWNLOADED', 'DELETED'])
  status?: 'DOWNLOADED' | 'DELETED';
}

interface PushContext {
  userId: string;
  deviceId: string | null;
}

/**
 * Applies operations queued offline by the mobile app (offline-first).
 * Every operation is idempotent: its client id is recorded once applied, so
 * a retried push reports DUPLICATE instead of applying it twice. Operations
 * are processed in the order received to keep causality (trip before points).
 */
@Injectable()
export class SynchronizationService {
  private readonly logger = new Logger(SynchronizationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly trips: TripsService,
    private readonly tracking: TrackingService,
    private readonly routes: SavedRoutesService,
    private readonly places: PlacesService,
    private readonly downloadedRegions: DownloadedRegionsService,
  ) {}

  async push(
    userId: string,
    installationId: string | undefined,
    operations: SyncOperation[],
  ): Promise<{ results: SyncOperationResult[]; serverTime: Date }> {
    const device = installationId
      ? await this.users.registerDevice(userId, { installationId })
      : null;
    const context: PushContext = { userId, deviceId: device?.id ?? null };

    const previous = await this.prisma.synchronizationEvent.findMany({
      where: { userId, clientOperationId: { in: operations.map((op) => op.id) } },
      select: { clientOperationId: true, status: true },
    });
    const applied = new Set(
      previous
        .filter((event) => event.status !== SyncEventStatus.FAILED)
        .map((event) => event.clientOperationId),
    );

    const results: SyncOperationResult[] = [];
    for (const operation of operations) {
      if (applied.has(operation.id)) {
        results.push({ id: operation.id, status: 'DUPLICATE' });
        continue;
      }
      results.push(await this.applyOne(context, operation));
      applied.add(operation.id);
    }
    return { results, serverTime: new Date() };
  }

  /**
   * Changes made on other devices since `since` (saved routes + deletions).
   * Returns at most 200 routes, oldest change first; `hasMore` tells the
   * client to pull again using the last route's updatedAt as `since`.
   */
  async pull(userId: string, since?: Date) {
    const serverTime = new Date();
    const updated = await this.routes.list(userId, {
      limit: 200,
      offset: 0,
      includeGeometry: true,
      updatedSince: since ?? new Date(0),
    });
    const routes: SavedRoute[] = updated.items;
    const deletions = await this.prisma.synchronizationEvent.findMany({
      where: {
        userId,
        entity: 'route',
        operation: 'DELETE',
        status: SyncEventStatus.APPLIED,
        ...(since ? { processedAt: { gt: since } } : {}),
      },
      select: { payload: true },
    });
    const deletedRouteIds = deletions
      .map((event) => (event.payload as { id?: unknown }).id)
      .filter((id): id is string => typeof id === 'string');
    return { serverTime, routes, deletedRouteIds, hasMore: updated.total > routes.length };
  }

  private async applyOne(context: PushContext, op: SyncOperation): Promise<SyncOperationResult> {
    try {
      const result = await this.dispatch(context, op);
      await this.record(context, op, SyncEventStatus.APPLIED);
      return { id: op.id, status: 'APPLIED', result };
    } catch (error) {
      if (error instanceof SyncValidationError) {
        await this.record(context, op, SyncEventStatus.FAILED, ErrorCode.VALIDATION_ERROR, error);
        return {
          id: op.id,
          status: 'FAILED',
          retryable: false,
          error: {
            code: ErrorCode.VALIDATION_ERROR,
            message: error.message,
            details: error.details,
          },
        };
      }
      if (error instanceof AppException) {
        const retryable = error.getStatus() >= 500 || error.getStatus() === 429;
        if (!retryable) await this.record(context, op, SyncEventStatus.FAILED, error.code, error);
        return {
          id: op.id,
          status: 'FAILED',
          retryable,
          error: { code: error.code, message: error.message },
        };
      }
      this.logger.error({ err: error, operation: op.id }, 'Sync operation failed unexpectedly');
      return {
        id: op.id,
        status: 'FAILED',
        retryable: true,
        error: { code: ErrorCode.INTERNAL_ERROR, message: 'Temporary server error' },
      };
    }
  }

  private async dispatch(context: PushContext, op: SyncOperation): Promise<unknown> {
    const { userId } = context;
    const key = `${op.entity}:${op.operation}`;
    switch (key) {
      case 'trip:CREATE': {
        const dto = await parsePayload(StartTripDto, op.payload);
        const trip = await this.trips.start(userId, {
          ...dto,
          startedAt: dto.startedAt ? new Date(dto.startedAt) : undefined,
        });
        if (context.deviceId && !trip.deviceId) {
          await this.prisma.trip.update({
            where: { id: trip.id },
            data: { deviceId: context.deviceId },
          });
        }
        return { tripId: trip.id };
      }
      case 'trip:FINISH': {
        const dto = await parsePayload(FinishTripPayload, op.payload);
        const trip = await this.trips.finish(
          userId,
          dto.id,
          dto.endedAt ? new Date(dto.endedAt) : undefined,
        );
        return { tripId: trip.id, distanceMeters: trip.distanceMeters };
      }
      case 'trip:CANCEL': {
        const dto = await parsePayload(EntityIdPayload, op.payload);
        await this.trips.cancel(userId, dto.id);
        return { tripId: dto.id };
      }
      case 'tracking_point:CREATE': {
        const batch = await parsePayload(TrackingBatchPayload, { points: op.payload.points });
        const rawPoints = batch.points ?? [op.payload];
        const points = [];
        for (const raw of rawPoints) {
          if (typeof raw !== 'object' || raw === null) {
            throw new SyncValidationError('Each point must be an object');
          }
          points.push(
            toLocationPoint(await parsePayload(TrackLocationDto, raw as Record<string, unknown>)),
          );
        }
        return this.tracking.recordBatch(userId, points);
      }
      case 'route:UPSERT':
      case 'route:CREATE': {
        const dto = await parsePayload(SaveRouteDto, op.payload);
        const route = await this.routes.save(userId, { ...dto, steps: dto.steps ?? [] });
        return { routeId: route.id };
      }
      case 'route:DELETE': {
        const dto = await parsePayload(EntityIdPayload, op.payload);
        return this.routes.delete(userId, dto.id);
      }
      case 'place:UPSERT':
      case 'place:CREATE': {
        const { id, ...rest } = op.payload;
        const dto = await parsePayload(CreatePlaceDto, rest);
        if (typeof id === 'string') {
          const existing = await this.prisma.place.findFirst({ where: { id, userId } });
          if (existing) return this.places.update(userId, id, dto);
        }
        return this.places.create(userId, {
          ...dto,
          id: typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id) ? id : undefined,
        });
      }
      case 'place:DELETE': {
        const dto = await parsePayload(EntityIdPayload, op.payload);
        return this.places.delete(userId, dto.id);
      }
      case 'downloaded_region:UPSERT':
      case 'downloaded_region:DELETE': {
        if (!context.deviceId) {
          throw new SyncValidationError('installationId is required for downloaded_region');
        }
        const dto = await parsePayload(DownloadedRegionPayload, op.payload);
        await this.downloadedRegions.record({
          userId,
          deviceId: context.deviceId,
          regionCode: dto.regionId,
          version: dto.version,
          status:
            op.operation === 'DELETE' || dto.status === 'DELETED'
              ? DownloadedRegionStatus.DELETED
              : DownloadedRegionStatus.DOWNLOADED,
        });
        return { regionId: dto.regionId };
      }
      default:
        throw new AppException(
          ErrorCode.SYNC_OPERATION_NOT_SUPPORTED,
          `Operation ${op.operation} is not supported for entity ${op.entity}`,
        );
    }
  }

  private async record(
    context: PushContext,
    op: SyncOperation,
    status: SyncEventStatus,
    errorCode?: string,
    error?: Error,
  ): Promise<void> {
    const data = {
      entity: op.entity,
      operation: op.operation,
      payload: op.payload as Prisma.InputJsonValue,
      status,
      errorCode: errorCode ?? null,
      errorMessage: error?.message.slice(0, 500) ?? null,
      clientCreatedAt: op.createdAt ?? null,
      deviceId: context.deviceId,
      processedAt: new Date(),
    };
    await this.prisma.synchronizationEvent.upsert({
      where: {
        userId_clientOperationId: { userId: context.userId, clientOperationId: op.id },
      },
      create: { userId: context.userId, clientOperationId: op.id, ...data },
      update: data,
    });
  }
}
