import { Injectable } from '@nestjs/common';
import { Paginated } from '../../../common/dto/pagination.dto';
import { AppException } from '../../../common/errors/app.exception';
import { ErrorCode } from '../../../common/errors/error-codes';
import { Prisma } from '../../../generated/prisma/client';
import { RoutingProfile } from '../../../generated/prisma/enums';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditActor, AuditService } from '../../audit/application/audit.service';
import { toShape, UpdateGeofenceDto } from '../../geofences/application/dto/geofence.dto';
import { GeofencesService } from '../../geofences/application/geofences.service';
import { Geofence } from '../../geofences/domain/geofence.entity';
import { CreatePlaceDto, UpdatePlaceDto } from '../../places/application/dto/place.dto';
import { PlacesService } from '../../places/application/places.service';
import { Place, PlaceWithUsage } from '../../places/domain/place.entity';
import { SavedRoutesService } from '../../routing/application/use-cases/saved-routes.service';
import { SavedRoute } from '../../routing/domain/entities/saved-route';
import { AccountRef } from './admin-operations.service';
import {
  CreateAdminGeofenceDto,
  ListAdminGeofencesQueryDto,
  ListAdminPlacesQueryDto,
  ListAdminRoutesQueryDto,
} from './dto/admin.dto';

export interface AdminGeofenceView extends Geofence {
  owner: AccountRef | null;
}

export interface AdminRouteView {
  id: string;
  name: string;
  profile: RoutingProfile;
  distanceMeters: number;
  durationSeconds: number;
  regionCode: string | null;
  provider: string | null;
  createdAt: Date;
  updatedAt: Date;
  owner: AccountRef;
  /** Trips that followed the route. */
  trips: number;
}

const ACCOUNT_REF = { select: { id: true, email: true, name: true } } as const;

/**
 * Geographic data of every account (administration): geofences, places — including the shared
 * places every account sees — and saved routes. Changes are written to the audit log; the owners'
 * apps receive them like any other change (events, `GET /sync/pull`).
 */
@Injectable()
export class AdminGeodataService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly geofences: GeofencesService,
    private readonly places: PlacesService,
    private readonly routes: SavedRoutesService,
    private readonly audit: AuditService,
  ) {}

  // --- Geofences --------------------------------------------------------------------------------

  async listGeofences(query: ListAdminGeofencesQueryDto): Promise<Paginated<AdminGeofenceView>> {
    const { items, total } = await this.geofences.search({
      userId: query.userId,
      active: query.active,
      text: query.q,
      limit: query.limit,
      offset: query.offset,
    });
    const owners = await this.accounts(items.map((item) => item.userId));
    return {
      items: items.map((item) => ({ ...item, owner: owners.get(item.userId) ?? null })),
      total,
      limit: query.limit,
      offset: query.offset,
    };
  }

  async geofence(id: string): Promise<AdminGeofenceView> {
    const owner = await this.geofenceOwner(id);
    const geofence = await this.geofences.get(owner.id, id);
    return { ...geofence, owner };
  }

  async createGeofence(actor: AuditActor, dto: CreateAdminGeofenceDto): Promise<AdminGeofenceView> {
    const owner = await this.account(dto.accountId);
    const geofence = await this.geofences.create(owner.id, {
      name: dto.name,
      description: dto.description,
      metadata: dto.metadata,
      active: dto.active,
      shape: toShape(dto)!,
    });
    await this.recordGeofence(actor, 'geofence.create', geofence, owner, {
      type: geofence.type,
    });
    return { ...geofence, owner };
  }

  async updateGeofence(
    actor: AuditActor,
    id: string,
    dto: UpdateGeofenceDto,
  ): Promise<AdminGeofenceView> {
    const owner = await this.geofenceOwner(id);
    const geofence = await this.geofences.update(owner.id, id, dto);
    await this.recordGeofence(
      actor,
      dto.active === false
        ? 'geofence.disable'
        : dto.active === true
          ? 'geofence.enable'
          : 'geofence.update',
      geofence,
      owner,
      { fields: Object.keys(dto) },
    );
    return { ...geofence, owner };
  }

  async deleteGeofence(actor: AuditActor, id: string): Promise<{ deleted: boolean }> {
    const owner = await this.geofenceOwner(id);
    const geofence = await this.geofences.get(owner.id, id);
    const result = await this.geofences.delete(owner.id, id);
    await this.recordGeofence(actor, 'geofence.delete', geofence, owner);
    return result;
  }

  // --- Places -----------------------------------------------------------------------------------

  async listPlaces(query: ListAdminPlacesQueryDto): Promise<Paginated<PlaceWithUsage>> {
    const { items, total } = await this.places.searchAll({
      scope: query.scope,
      userId: query.userId,
      text: query.q,
      limit: query.limit,
      offset: query.offset,
    });
    return { items, total, limit: query.limit, offset: query.offset };
  }

  /** Creates a shared place: every account sees it in searches. */
  async createPlace(actor: AuditActor, dto: CreatePlaceDto): Promise<Place> {
    const place = await this.places.createShared(dto);
    await this.recordPlace(actor, 'place.create', place);
    return place;
  }

  async updatePlace(actor: AuditActor, id: string, dto: UpdatePlaceDto): Promise<Place> {
    const place = await this.places.updateShared(id, dto);
    await this.recordPlace(actor, 'place.update', place, { fields: Object.keys(dto) });
    return place;
  }

  async deletePlace(actor: AuditActor, id: string): Promise<{ deleted: true }> {
    const place = await this.prisma.place.findFirst({
      where: { id, userId: null },
      select: { id: true, name: true },
    });
    if (!place) throw AppException.notFound(ErrorCode.PLACE_NOT_FOUND, 'Shared place not found');
    const result = await this.places.deleteShared(id);
    await this.recordPlace(actor, 'place.delete', place);
    return result;
  }

  // --- Saved routes -----------------------------------------------------------------------------

  async listRoutes(query: ListAdminRoutesQueryDto): Promise<Paginated<AdminRouteView>> {
    const where: Prisma.RouteWhereInput = {
      ...(query.userId ? { userId: query.userId } : {}),
      ...(query.q
        ? {
            OR: [
              { name: { contains: query.q, mode: 'insensitive' } },
              { regionCode: { contains: query.q, mode: 'insensitive' } },
              { user: { email: { contains: query.q, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.route.findMany({
        where,
        select: {
          id: true,
          name: true,
          profile: true,
          distanceMeters: true,
          durationSeconds: true,
          regionCode: true,
          provider: true,
          createdAt: true,
          updatedAt: true,
          user: ACCOUNT_REF,
          _count: { select: { trips: true } },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        take: query.limit,
        skip: query.offset,
      }),
      this.prisma.route.count({ where }),
    ]);
    return {
      items: rows.map(({ user, _count, ...route }) => ({
        ...route,
        owner: user,
        trips: _count.trips,
      })),
      total,
      limit: query.limit,
      offset: query.offset,
    };
  }

  /** The route with its geometry and instructions. */
  async route(id: string): Promise<SavedRoute & { owner: AccountRef }> {
    const owner = await this.routeOwner(id);
    return { ...(await this.routes.get(owner.id, id)), owner };
  }

  /** Deletes a saved route; the owner's devices drop it at their next synchronisation. */
  async deleteRoute(actor: AuditActor, id: string): Promise<{ deleted: boolean }> {
    const owner = await this.routeOwner(id);
    const route = await this.routes.get(owner.id, id);
    const result = await this.routes.delete(owner.id, id);
    await this.audit.record(actor, {
      action: 'route.delete',
      targetType: 'route',
      targetId: id,
      summary: `${route.name} · ${owner.email}`,
    });
    return result;
  }

  // --- Helpers ----------------------------------------------------------------------------------

  private async account(id: string): Promise<AccountRef> {
    const account = await this.prisma.user.findUnique({ where: { id }, ...ACCOUNT_REF });
    if (!account) throw AppException.notFound(ErrorCode.USER_NOT_FOUND, 'Account not found');
    return account;
  }

  private async accounts(ids: string[]): Promise<Map<string, AccountRef>> {
    if (ids.length === 0) return new Map();
    const rows = await this.prisma.user.findMany({
      where: { id: { in: [...new Set(ids)] } },
      ...ACCOUNT_REF,
    });
    return new Map(rows.map((row) => [row.id, row]));
  }

  private async geofenceOwner(id: string): Promise<AccountRef> {
    const geofence = await this.prisma.geofence.findUnique({
      where: { id },
      select: { user: ACCOUNT_REF },
    });
    if (!geofence) throw AppException.notFound(ErrorCode.GEOFENCE_NOT_FOUND, 'Geofence not found');
    return geofence.user;
  }

  private async routeOwner(id: string): Promise<AccountRef> {
    const route = await this.prisma.route.findUnique({
      where: { id },
      select: { user: ACCOUNT_REF },
    });
    if (!route) throw AppException.notFound(ErrorCode.ROUTE_NOT_FOUND, 'Saved route not found');
    return route.user;
  }

  private recordGeofence(
    actor: AuditActor,
    action: string,
    geofence: { id: string; name: string },
    owner: AccountRef,
    details?: Record<string, unknown>,
  ): Promise<void> {
    return this.audit.record(actor, {
      action,
      targetType: 'geofence',
      targetId: geofence.id,
      summary: `${geofence.name} · ${owner.email}`,
      details: { accountId: owner.id, ...details },
    });
  }

  private recordPlace(
    actor: AuditActor,
    action: string,
    place: { id: string; name: string },
    details?: Record<string, unknown>,
  ): Promise<void> {
    return this.audit.record(actor, {
      action,
      targetType: 'place',
      targetId: place.id,
      summary: place.name,
      details,
    });
  }
}
