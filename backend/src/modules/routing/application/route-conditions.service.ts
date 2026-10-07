import { Injectable, Logger } from '@nestjs/common';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AppConfigService } from '../../../config/app-config.service';
import { BoundingBox, Position } from '../../../common/geo/geojson';
import { RouteResult, bboxOf } from '../domain/entities/route-result';
import { RoutingProfile } from '../domain/value-objects/routing-profile';

interface ClimateZone {
  id: string;
  range: string;
  district: string | null;
  annualMinMm: number | null;
  annualMaxMm: number | null;
  bbox: [number, number, number, number];
  polygons: Position[][][];
}

export interface RouteConditions {
  traffic: {
    status: 'observed' | 'insufficient_data';
    windowMinutes: 15;
    averageSpeedKph: number | null;
    sampleCount: number;
    tripCount: number;
    delaySeconds: number;
  };
  climate: {
    status: 'climatology' | 'unavailable';
    basis: 'annual-precipitation-regions';
    zones: {
      range: string;
      district: string | null;
      annualMinMm: number | null;
      annualMaxMm: number | null;
    }[];
    warnings: string[];
  };
  baseDurationSeconds: number;
  adjustedDurationSeconds: number;
}

const MOTOR: RoutingProfile[] = ['CAR', 'MOTORCYCLE', 'TRUCK'];
/** Trips whose speeds tell how a route of each profile flows: the same kind of vehicle. */
const COMPARABLE_PROFILES: Record<RoutingProfile, RoutingProfile[]> = {
  CAR: MOTOR,
  MOTORCYCLE: MOTOR,
  TRUCK: MOTOR,
  BICYCLE: ['BICYCLE'],
  PEDESTRIAN: ['PEDESTRIAN'],
};

/** Fixes this close to a route tell how it flows. */
const NEAR_ROUTE_METERS = 150;

/**
 * The box of a route widened by twice NEAR_ROUTE_METERS, counting 110 km per degree (fewer meters
 * than any degree has): the spatial index of the fixes narrows the search with it, with room to
 * spare, before the exact distance is measured.
 */
function nearRouteBox(positions: Position[]): BoundingBox {
  const [west, south, east, north] = bboxOf(positions);
  const dLat = (2 * NEAR_ROUTE_METERS) / 110_000;
  const farthestLat = Math.min(Math.max(Math.abs(south), Math.abs(north)) + dLat, 89);
  const dLng = dLat / Math.cos((farthestLat * Math.PI) / 180);
  return [west - dLng, south - dLat, east + dLng, north + dLat];
}

/** Adds first-party traffic observations and locally cached climate zones to a route. */
@Injectable()
export class RouteConditionsService {
  private readonly logger = new Logger(RouteConditionsService.name);
  private climate: { mtimeMs: number; zones: ClimateZone[] } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
  ) {}

  async evaluate(route: RouteResult, profile: RoutingProfile): Promise<RouteConditions> {
    const [traffic, climate] = await Promise.all([
      this.traffic(route, profile).catch((error: unknown) => {
        this.logger.warn({ err: error }, 'Could not evaluate route traffic');
        return null;
      }),
      this.climateAlong(route.geometry.coordinates).catch((error: unknown) => {
        this.logger.warn({ err: error }, 'Could not evaluate route climate');
        return null;
      }),
    ]);
    const observedSpeed = traffic?.average_speed_kph ?? null;
    const expectedSpeed =
      route.durationSeconds > 0 ? (route.distanceMeters / route.durationSeconds) * 3.6 : 0;
    const factor =
      observedSpeed && expectedSpeed > observedSpeed
        ? Math.min(expectedSpeed / observedSpeed, 2.5)
        : 1;
    const adjusted = Math.round(route.durationSeconds * factor);
    return {
      traffic: {
        status: traffic ? 'observed' : 'insufficient_data',
        windowMinutes: 15,
        averageSpeedKph: observedSpeed,
        sampleCount: traffic ? Number(traffic.samples) : 0,
        tripCount: traffic ? Number(traffic.trips) : 0,
        delaySeconds: Math.max(0, adjusted - route.durationSeconds),
      },
      climate: {
        status: climate ? 'climatology' : 'unavailable',
        basis: 'annual-precipitation-regions',
        zones: climate ?? [],
        warnings: (climate ?? [])
          .filter((zone) => (zone.annualMaxMm ?? 0) >= 2500)
          .map((zone) => `El trayecto cruza una zona de precipitación anual alta (${zone.range}).`),
      },
      baseDurationSeconds: route.durationSeconds,
      adjustedDurationSeconds: adjusted,
    };
  }

  /**
   * Fixes of the last 15 minutes near the route, from trips of the same kind of vehicle and as
   * plausible as those of the traffic map. Both the time and the box use an index of the fixes.
   */
  private async traffic(route: RouteResult, profile: RoutingProfile) {
    const geometry = JSON.stringify(route.geometry);
    const box = nearRouteBox(route.geometry.coordinates);
    const rows = await this.prisma.$queryRaw<
      { average_speed_kph: number; samples: bigint; trips: bigint }[]
    >`
      SELECT round((avg(p.speed) * 3.6)::numeric, 1)::double precision AS average_speed_kph,
             count(*) AS samples, count(DISTINCT p.trip_id) AS trips
      FROM trip_points p
      JOIN trips t ON t.id = p.trip_id
      WHERE p.recorded_at >= now() - interval '15 minutes'
        AND p.location && ST_MakeEnvelope(${box[0]}, ${box[1]}, ${box[2]}, ${box[3]}, 4326)
        AND p.speed IS NOT NULL AND p.speed >= 0 AND p.speed < 70
        AND (p.accuracy IS NULL OR p.accuracy <= 50)
        AND t.profile::text IN (${Prisma.join(COMPARABLE_PROFILES[profile])})
        AND ST_DWithin(
          p.location::geography,
          ST_SetSRID(ST_GeomFromGeoJSON(${geometry}), 4326)::geography,
          ${NEAR_ROUTE_METERS}
        )
      HAVING count(*) >= 5 AND count(DISTINCT p.trip_id) >= 3`;
    return rows[0] ?? null;
  }

  private async climateAlong(positions: Position[]) {
    const zones = await this.loadClimate();
    if (zones.length === 0) return null;
    const stride = Math.max(1, Math.floor(positions.length / 150));
    const found = new Map<string, ClimateZone>();
    for (let index = 0; index < positions.length; index += stride) {
      const point = positions[index];
      for (const zone of zones) {
        if (found.has(zone.id) || !insideBbox(point, zone.bbox)) continue;
        if (zone.polygons.some((polygon) => insidePolygon(point, polygon)))
          found.set(zone.id, zone);
      }
    }
    const unique = new Map<string, ClimateZone>();
    for (const zone of found.values()) unique.set(`${zone.range}|${zone.district ?? ''}`, zone);
    return [...unique.values()]
      .sort((a, b) => (b.annualMaxMm ?? 0) - (a.annualMaxMm ?? 0))
      .slice(0, 20)
      .map(({ range, district, annualMinMm, annualMaxMm }) => ({
        range,
        district,
        annualMinMm,
        annualMaxMm,
      }));
  }

  private async loadClimate(): Promise<ClimateZone[]> {
    const file = join(
      this.config.get('geocoding').nativeDataPath,
      'climate-precipitation-regions.geojson',
    );
    const info = await stat(file);
    if (this.climate?.mtimeMs === info.mtimeMs) return this.climate.zones;
    const collection = JSON.parse(await readFile(file, 'utf8')) as {
      features?: {
        id?: string;
        properties?: Record<string, unknown>;
        geometry?: { type?: string; coordinates?: unknown };
      }[];
    };
    const zones: ClimateZone[] = [];
    for (const feature of collection.features ?? []) {
      const raw = feature.geometry?.coordinates;
      const polygons = feature.geometry?.type === 'Polygon' ? [raw] : raw;
      if (!Array.isArray(polygons)) continue;
      const valid = polygons.filter(Array.isArray) as Position[][][];
      const points = valid.flat(2);
      if (points.length === 0) continue;
      const range = scalarText(feature.properties?.rango) ?? 'Sin rango';
      const numbers =
        range.match(/\d+(?:[.,]\d+)?/g)?.map((value) => Number(value.replace(',', '.'))) ?? [];
      zones.push({
        id: feature.id ?? scalarText(feature.properties?.ogc_fid) ?? String(zones.length),
        range,
        district: text(feature.properties?.dhnom),
        annualMinMm: numbers[0] ?? null,
        annualMaxMm: numbers[1] ?? numbers[0] ?? null,
        bbox: bbox(points),
        polygons: valid,
      });
    }
    this.climate = { mtimeMs: info.mtimeMs, zones };
    return zones;
  }
}

const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

const scalarText = (value: unknown): string | null =>
  typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
    ? String(value)
    : null;

const bbox = (points: Position[]): [number, number, number, number] => {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const [x, y] of points) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return [minX, minY, maxX, maxY];
};

const insideBbox = ([x, y]: Position, [minX, minY, maxX, maxY]: [number, number, number, number]) =>
  x >= minX && x <= maxX && y >= minY && y <= maxY;

const insideRing = ([x, y]: Position, ring: Position[]): boolean => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};

const insidePolygon = (point: Position, rings: Position[][]): boolean =>
  rings.length > 0 &&
  insideRing(point, rings[0]) &&
  !rings.slice(1).some((ring) => insideRing(point, ring));
