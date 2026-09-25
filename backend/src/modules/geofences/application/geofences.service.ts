import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { AppException } from '../../../common/errors/app.exception';
import { ErrorCode } from '../../../common/errors/error-codes';
import {
  Coordinate,
  isValidCoordinate,
  isValidPolygon,
  PolygonGeometry,
} from '../../../common/geo/geojson';
import { GeofenceType } from '../../../generated/prisma/enums';
import {
  Geofence,
  GEOFENCE_REPOSITORY,
  GeofenceInput,
  type GeofenceRepository,
  GeofenceShape,
} from '../domain/geofence.entity';

export interface GeofencePatch {
  name?: string;
  description?: string | null;
  metadata?: Record<string, unknown> | null;
  active?: boolean;
  type?: GeofenceType;
  center?: Coordinate;
  radiusMeters?: number;
  polygon?: PolygonGeometry;
}

export const MAX_RADIUS_METERS = 100_000;
export const MAX_POLYGON_VERTICES = 5_000;

@Injectable()
export class GeofencesService {
  constructor(@Inject(GEOFENCE_REPOSITORY) private readonly geofences: GeofenceRepository) {}

  async create(userId: string, input: GeofenceInput): Promise<Geofence> {
    await this.validateShape(input.shape);
    return this.geofences.create(userId, input);
  }

  /**
   * Partial update. Shape fields are merged with the stored geofence, so a
   * circle can change only its radius and a polygon can become a circle by
   * sending `type` plus the new shape fields.
   */
  async update(userId: string, id: string, patch: GeofencePatch): Promise<Geofence> {
    const touchesShape =
      patch.type !== undefined ||
      patch.center !== undefined ||
      patch.radiusMeters !== undefined ||
      patch.polygon !== undefined;
    let shape: GeofenceShape | undefined;
    if (touchesShape) {
      const current = await this.get(userId, id);
      shape = this.mergeShape(current, patch);
      await this.validateShape(shape);
    }
    const geofence = await this.geofences.update(userId, id, {
      name: patch.name,
      description: patch.description,
      metadata: patch.metadata,
      active: patch.active,
      shape,
    });
    if (!geofence) throw AppException.notFound(ErrorCode.GEOFENCE_NOT_FOUND, 'Geofence not found');
    return geofence;
  }

  async get(userId: string, id: string): Promise<Geofence> {
    const geofence = await this.geofences.findById(userId, id);
    if (!geofence) throw AppException.notFound(ErrorCode.GEOFENCE_NOT_FOUND, 'Geofence not found');
    return geofence;
  }

  list(userId: string, activeOnly = false): Promise<Geofence[]> {
    return this.geofences.list(userId, { activeOnly });
  }

  async delete(userId: string, id: string): Promise<{ deleted: boolean }> {
    const deleted = await this.geofences.delete(userId, id);
    if (!deleted) throw AppException.notFound(ErrorCode.GEOFENCE_NOT_FOUND, 'Geofence not found');
    return { deleted };
  }

  async check(userId: string, point: Coordinate): Promise<{ inside: Geofence[] }> {
    if (!isValidCoordinate(point)) {
      throw new AppException(ErrorCode.INVALID_COORDINATES, 'Coordinates are out of range');
    }
    return { inside: await this.geofences.findContaining(userId, point) };
  }

  private mergeShape(current: Geofence, patch: GeofencePatch): GeofenceShape {
    const type = patch.type ?? current.type;
    if (type === 'CIRCLE') {
      const center = patch.center ?? current.center;
      const radiusMeters = patch.radiusMeters ?? current.radiusMeters;
      if (!center || radiusMeters == null) {
        throw new AppException(
          ErrorCode.VALIDATION_ERROR,
          'CIRCLE geofences require center and radiusMeters',
        );
      }
      return { type: 'CIRCLE', center, radiusMeters };
    }
    const polygon = patch.polygon ?? (current.type === 'POLYGON' ? current.geometry : undefined);
    if (!polygon) {
      throw new AppException(ErrorCode.VALIDATION_ERROR, 'POLYGON geofences require polygon');
    }
    return { type: 'POLYGON', polygon };
  }

  private async validateShape(shape: GeofenceShape): Promise<void> {
    if (shape.type === 'CIRCLE') {
      if (!shape.center || !isValidCoordinate(shape.center)) {
        throw new AppException(ErrorCode.INVALID_COORDINATES, 'Circle center is out of range');
      }
      if (!(shape.radiusMeters > 0 && shape.radiusMeters <= MAX_RADIUS_METERS)) {
        throw new AppException(
          ErrorCode.INVALID_GEOMETRY,
          `radiusMeters must be between 0 and ${MAX_RADIUS_METERS}`,
        );
      }
      return;
    }
    if (!isValidPolygon(shape.polygon)) {
      throw new AppException(
        ErrorCode.INVALID_GEOMETRY,
        'polygon must be a closed GeoJSON Polygon with valid [lng, lat] positions',
      );
    }
    const vertices = shape.polygon.coordinates.reduce((sum, ring) => sum + ring.length, 0);
    if (vertices > MAX_POLYGON_VERTICES) {
      throw new AppException(
        ErrorCode.INVALID_GEOMETRY,
        `polygon cannot have more than ${MAX_POLYGON_VERTICES} vertices`,
      );
    }
    if (!(await this.geofences.isValidPolygon(shape.polygon))) {
      throw new AppException(
        ErrorCode.INVALID_GEOMETRY,
        'polygon is not a valid simple geometry (self-intersection?)',
        HttpStatus.BAD_REQUEST,
      );
    }
  }
}
