import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Paginated } from '../../../../common/dto/pagination.dto';
import { AppException } from '../../../../common/errors/app.exception';
import { ErrorCode } from '../../../../common/errors/error-codes';
import { isValidCoordinate, isValidLineString } from '../../../../common/geo/geojson';
import {
  ROUTE_REPOSITORY,
  type RouteRepository,
  SavedRoute,
  SaveRouteInput,
} from '../../domain/entities/saved-route';

/** Upper bound for stored geometries (vertices) to keep rows and payloads reasonable. */
const MAX_GEOMETRY_POINTS = 100_000;

@Injectable()
export class SavedRoutesService {
  constructor(@Inject(ROUTE_REPOSITORY) private readonly routes: RouteRepository) {}

  async save(userId: string, input: SaveRouteInput): Promise<SavedRoute> {
    if (!isValidCoordinate(input.origin) || !isValidCoordinate(input.destination)) {
      throw new AppException(ErrorCode.INVALID_COORDINATES, 'Coordinates are out of range');
    }
    if (!isValidLineString(input.geometry)) {
      throw new AppException(
        ErrorCode.INVALID_GEOMETRY,
        'geometry must be a GeoJSON LineString with at least two valid [lng, lat] positions',
      );
    }
    if (input.geometry.coordinates.length > MAX_GEOMETRY_POINTS) {
      throw new AppException(ErrorCode.INVALID_GEOMETRY, 'Route geometry has too many points');
    }
    const saved = await this.routes.upsert(userId, { ...input, id: input.id ?? randomUUID() });
    if (!saved) {
      throw new AppException(
        ErrorCode.CONFLICT,
        'A route with this id already exists',
        HttpStatus.CONFLICT,
      );
    }
    return saved;
  }

  async get(userId: string, id: string): Promise<SavedRoute> {
    const route = await this.routes.findById(userId, id);
    if (!route) throw AppException.notFound(ErrorCode.ROUTE_NOT_FOUND, 'Saved route not found');
    return route;
  }

  async list(
    userId: string,
    options: { limit: number; offset: number; includeGeometry: boolean; updatedSince?: Date },
  ): Promise<Paginated<SavedRoute>> {
    const { items, total } = await this.routes.list(userId, options);
    return { items, total, limit: options.limit, offset: options.offset };
  }

  async delete(userId: string, id: string): Promise<{ deleted: boolean }> {
    return { deleted: await this.routes.delete(userId, id) };
  }
}
