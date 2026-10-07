import { Injectable } from '@nestjs/common';
import { Paginated } from '../../../common/dto/pagination.dto';
import { AppException } from '../../../common/errors/app.exception';
import { ErrorCode } from '../../../common/errors/error-codes';
import { AppConfigService } from '../../../config/app-config.service';
import { Prisma } from '../../../generated/prisma/client';
import {
  DevicePlatform,
  DownloadedRegionStatus,
  SyncEventStatus,
} from '../../../generated/prisma/enums';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditActor, AuditService } from '../../audit/application/audit.service';
import { MapRegionResponse, toRegionResponse } from '../../regions/application/dto/region.dto';
import { MapRegionService } from '../../regions/application/map-region.service';
import { TripsService } from '../../trips/application/trips.service';
import { LiveTrip, toTrip, Trip, TripPath } from '../../trips/domain/trip.entity';
import {
  ListAdminTripsQueryDto,
  ListDevicesQueryDto,
  ListSyncEventsQueryDto,
} from './dto/admin.dto';

export interface AccountRef {
  id: string;
  email: string;
  name: string;
}

export interface DeviceRef {
  id: string;
  installationId: string;
  platform: DevicePlatform;
  model: string | null;
}

export interface AdminTripView extends Trip {
  user: AccountRef;
  device: DeviceRef | null;
}

export interface AdminTripDetail extends AdminTripView {
  route: { id: string; name: string } | null;
  /** Geofences the trip is inside of, as of its last checked fix. */
  geofencesInside: { id: string; name: string; enteredAt: Date }[];
}

export interface AdminDeviceView extends DeviceRef {
  appVersion: string | null;
  lastSeenAt: Date;
  createdAt: Date;
  user: AccountRef;
  trips: number;
  /** Regions the app reports as stored on the device. */
  regionsStored: number;
}

export interface SyncEventView {
  id: string;
  clientOperationId: string;
  entity: string;
  operation: string;
  status: SyncEventStatus;
  errorCode: string | null;
  errorMessage: string | null;
  clientCreatedAt: Date | null;
  processedAt: Date;
  user: { id: string; email: string };
  device: { id: string; installationId: string } | null;
}

export interface AdminRegionView extends MapRegionResponse {
  downloads: {
    /** Devices that keep the region offline. */
    devices: number;
    /** Of those, devices with the latest version. */
    upToDate: number;
  };
}

const ACCOUNT_REF = { select: { id: true, email: true, name: true } } as const;
const DEVICE_REF = {
  select: { id: true, installationId: true, platform: true, model: true },
} as const;

const SYNC_EVENT_SELECT = {
  id: true,
  clientOperationId: true,
  entity: true,
  operation: true,
  status: true,
  errorCode: true,
  errorMessage: true,
  clientCreatedAt: true,
  processedAt: true,
  user: { select: { id: true, email: true } },
  device: { select: { id: true, installationId: true } },
} satisfies Prisma.SynchronizationEventSelect;

const contains = (text: string) => ({ contains: text, mode: 'insensitive' as const });

/**
 * Day-to-day operation across every account (administration panel): trips and their tracks,
 * live positions, devices, offline synchronisation and the map regions devices keep.
 */
@Injectable()
export class AdminOperationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly trips: TripsService,
    private readonly regions: MapRegionService,
    private readonly audit: AuditService,
    private readonly config: AppConfigService,
  ) {}

  async listTrips(query: ListAdminTripsQueryDto): Promise<Paginated<AdminTripView>> {
    const startedAt: Prisma.DateTimeFilter = {
      ...(query.from ? { gte: new Date(query.from) } : {}),
      ...(query.to ? { lt: new Date(query.to) } : {}),
    };
    const where: Prisma.TripWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.userId ? { userId: query.userId } : {}),
      ...(query.from || query.to ? { startedAt } : {}),
      ...(query.q
        ? {
            OR: [
              { name: contains(query.q) },
              { user: { email: contains(query.q) } },
              { device: { installationId: contains(query.q) } },
              { device: { model: contains(query.q) } },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.trip.findMany({
        where,
        include: { user: ACCOUNT_REF, device: DEVICE_REF, _count: { select: { points: true } } },
        orderBy: [{ startedAt: 'desc' }, { id: 'asc' }],
        take: query.limit,
        skip: query.offset,
      }),
      this.prisma.trip.count({ where }),
    ]);
    return {
      items: rows.map((row) => ({ ...toTrip(row), user: row.user, device: row.device })),
      total,
      limit: query.limit,
      offset: query.offset,
    };
  }

  async trip(id: string): Promise<AdminTripDetail> {
    const row = await this.prisma.trip.findUnique({
      where: { id },
      include: {
        user: ACCOUNT_REF,
        device: DEVICE_REF,
        route: { select: { id: true, name: true } },
        geofenceStates: {
          orderBy: { enteredAt: 'asc' },
          include: { geofence: { select: { name: true } } },
        },
        _count: { select: { points: true } },
      },
    });
    if (!row) throw AppException.notFound(ErrorCode.TRIP_NOT_FOUND, 'Trip not found');
    return {
      ...toTrip(row),
      user: row.user,
      device: row.device,
      route: row.route,
      geofencesInside: row.geofenceStates.map((state) => ({
        id: state.geofenceId,
        name: state.geofence.name,
        enteredAt: state.enteredAt,
      })),
    };
  }

  async tripPath(id: string, maxPoints: number): Promise<TripPath> {
    const trip = await this.tripOwner(id);
    return this.trips.path(trip.userId, id, maxPoints);
  }

  /** Completes an active trip of any account (its trip.finished event is emitted as usual). */
  async finishTrip(actor: AuditActor, id: string): Promise<AdminTripDetail> {
    const trip = await this.tripOwner(id);
    await this.trips.finish(trip.userId, id);
    await this.recordTrip(actor, 'trip.finish', trip);
    return this.trip(id);
  }

  async cancelTrip(actor: AuditActor, id: string): Promise<AdminTripDetail> {
    const trip = await this.tripOwner(id);
    await this.trips.cancel(trip.userId, id);
    await this.recordTrip(actor, 'trip.cancel', trip);
    return this.trip(id);
  }

  /** Active trips of every account with their last position (live map). */
  live(): Promise<LiveTrip[]> {
    return this.trips.live();
  }

  async devices(query: ListDevicesQueryDto): Promise<Paginated<AdminDeviceView>> {
    const where: Prisma.DeviceWhereInput = {
      ...(query.platform ? { platform: query.platform } : {}),
      ...(query.userId ? { userId: query.userId } : {}),
      ...(query.q
        ? {
            OR: [
              { installationId: contains(query.q) },
              { model: contains(query.q) },
              { appVersion: contains(query.q) },
              { user: { email: contains(query.q) } },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.device.findMany({
        where,
        include: {
          user: ACCOUNT_REF,
          _count: {
            select: {
              trips: true,
              downloadedRegions: { where: { status: DownloadedRegionStatus.DOWNLOADED } },
            },
          },
        },
        orderBy: [{ lastSeenAt: 'desc' }, { id: 'asc' }],
        take: query.limit,
        skip: query.offset,
      }),
      this.prisma.device.count({ where }),
    ]);
    return {
      items: rows.map((row) => ({
        id: row.id,
        installationId: row.installationId,
        platform: row.platform,
        model: row.model,
        appVersion: row.appVersion,
        lastSeenAt: row.lastSeenAt,
        createdAt: row.createdAt,
        user: row.user,
        trips: row._count.trips,
        regionsStored: row._count.downloadedRegions,
      })),
      total,
      limit: query.limit,
      offset: query.offset,
    };
  }

  /** Operations the apps uploaded from their offline queues, newest first. */
  async syncEvents(query: ListSyncEventsQueryDto): Promise<Paginated<SyncEventView>> {
    const where: Prisma.SynchronizationEventWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.userId ? { userId: query.userId } : {}),
      ...(query.deviceId ? { deviceId: query.deviceId } : {}),
      ...(query.entity ? { entity: query.entity } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.synchronizationEvent.findMany({
        where,
        select: SYNC_EVENT_SELECT,
        orderBy: [{ processedAt: 'desc' }, { id: 'asc' }],
        take: query.limit,
        skip: query.offset,
      }),
      this.prisma.synchronizationEvent.count({ where }),
    ]);
    return { items, total, limit: query.limit, offset: query.offset };
  }

  /** One uploaded operation with the payload the app sent. */
  async syncEvent(id: string): Promise<SyncEventView & { payload: unknown }> {
    const event = await this.prisma.synchronizationEvent.findUnique({
      where: { id },
      select: { ...SYNC_EVENT_SELECT, payload: true },
    });
    if (!event) throw AppException.notFound(ErrorCode.NOT_FOUND, 'Synchronization event not found');
    return event;
  }

  /** Every region, disabled ones included, with how many devices keep it offline. */
  async regionsWithDownloads(): Promise<AdminRegionView[]> {
    const [regions, groups] = await Promise.all([
      this.regions.list(true),
      this.prisma.downloadedRegion.groupBy({
        by: ['regionId', 'version'],
        where: { status: DownloadedRegionStatus.DOWNLOADED },
        _count: { _all: true },
      }),
    ]);
    const tilesBase = this.config.get('maps').publicTilesBaseUrl;
    return regions.map((region) => {
      const stored = groups.filter((group) => group.regionId === region.id);
      return {
        ...toRegionResponse(region, tilesBase),
        downloads: {
          devices: stored.reduce((sum, group) => sum + group._count._all, 0),
          upToDate: stored
            .filter((group) => group.version === region.version)
            .reduce((sum, group) => sum + group._count._all, 0),
        },
      };
    });
  }

  private async tripOwner(id: string) {
    const trip = await this.prisma.trip.findUnique({
      where: { id },
      select: { id: true, userId: true, name: true, user: { select: { email: true } } },
    });
    if (!trip) throw AppException.notFound(ErrorCode.TRIP_NOT_FOUND, 'Trip not found');
    return trip;
  }

  private recordTrip(
    actor: AuditActor,
    action: string,
    trip: { id: string; name: string | null; user: { email: string } },
  ): Promise<void> {
    return this.audit.record(actor, {
      action,
      targetType: 'trip',
      targetId: trip.id,
      summary: trip.name ? `${trip.name} · ${trip.user.email}` : trip.user.email,
    });
  }
}
