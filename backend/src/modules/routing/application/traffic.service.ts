import { Inject, Injectable, Logger } from '@nestjs/common';
import { CACHE_PROVIDER, type CacheProvider } from '../../../infrastructure/cache/cache.provider';
import { CLASS, NativeGraph } from '../../../infrastructure/native/native-graph';
import {
  NATIVE_GRAPH_STORE,
  type NativeGraphStore,
} from '../../../infrastructure/native/native-graph.store';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AppException } from '../../../common/errors/app.exception';
import { ErrorCode } from '../../../common/errors/error-codes';
import { Position } from '../../../common/geo/geojson';
import { NativeRouter } from '../infrastructure/native/native-router';

/**
 * Live traffic and activity from the platform's own anonymous trip fixes. Nothing is invented:
 * a road segment only gets a traffic colour when enough recent fixes from different trips were
 * matched to it, and activity cells need several distinct trips (privacy).
 */

export type BoundingBoxQuery = [number, number, number, number];

export interface TrafficFeature {
  type: 'Feature';
  geometry: { type: 'LineString'; coordinates: Position[] };
  properties: {
    speedKph: number;
    freeFlowKph: number;
    ratio: number;
    status: 'free' | 'moderate' | 'slow' | 'jammed';
    samples: number;
    trips: number;
  };
}

export interface TrafficFlow {
  type: 'FeatureCollection';
  windowMinutes: number;
  generatedAt: string;
  features: TrafficFeature[];
}

export interface ActivityCell {
  type: 'Feature';
  geometry: { type: 'Point'; coordinates: Position };
  properties: { trips: number; samples: number };
}

const WINDOW_MINUTES = 15;
const ACTIVITY_HOURS = 24;
const MATCH_METERS = 25;
const MIN_SAMPLES = 3;
const MIN_TRIPS = 2;
const MIN_ACTIVITY_TRIPS = 3;
/** Largest box accepted (degrees): about a province. */
const MAX_SPAN = 2.5;

@Injectable()
export class TrafficService {
  private readonly logger = new Logger(TrafficService.name);
  private router: { graph: NativeGraph; router: NativeRouter } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(NATIVE_GRAPH_STORE) private readonly graphs: NativeGraphStore,
    @Inject(CACHE_PROVIDER) private readonly cache: CacheProvider,
  ) {}

  async flow(bbox: BoundingBoxQuery): Promise<TrafficFlow> {
    const box = this.validate(bbox);
    const key = `traffic:v1:flow:${box.map((value) => value.toFixed(2)).join(',')}`;
    const cached = await this.cache.get<TrafficFlow>(key);
    if (cached) return cached;
    const graph = await this.graphs.get();
    if (this.router?.graph !== graph) this.router = { graph, router: new NativeRouter(graph) };
    const router = this.router.router;
    const rows = await this.prisma.$queryRaw<
      { lon: number; lat: number; speed: number; trip_id: string }[]
    >`
      SELECT ST_X(p.location) AS lon, ST_Y(p.location) AS lat, p.speed, p.trip_id::text AS trip_id
      FROM trip_points p
      JOIN trips t ON t.id = p.trip_id
      WHERE p.recorded_at >= now() - make_interval(mins => ${WINDOW_MINUTES})
        AND p.speed IS NOT NULL AND p.speed >= 0 AND p.speed < 70
        AND (p.accuracy IS NULL OR p.accuracy <= 50)
        AND t.profile IN ('CAR', 'MOTORCYCLE', 'TRUCK')
        AND p.location && ST_MakeEnvelope(${box[0]}, ${box[1]}, ${box[2]}, ${box[3]}, 4326)
      LIMIT 50000`;
    const motor = (edge: number) =>
      graph.edgeClass[edge] <= CLASS.track && graph.edgeClass[edge] !== CLASS.connector;
    const perEdge = new Map<number, { speeds: number[]; trips: Set<string> }>();
    for (const row of rows) {
      const [match] = graph.nearestEdges(row.lon, row.lat, MATCH_METERS, motor, 1);
      if (!match) continue;
      const entry = perEdge.get(match.edge) ?? { speeds: [], trips: new Set<string>() };
      entry.speeds.push(row.speed * 3.6);
      entry.trips.add(row.trip_id);
      perEdge.set(match.edge, entry);
    }
    const features: TrafficFeature[] = [];
    for (const [edge, entry] of perEdge) {
      if (entry.speeds.length < MIN_SAMPLES || entry.trips.size < MIN_TRIPS) continue;
      const sorted = [...entry.speeds].sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)];
      const freeFlow = router.speed('CAR', edge);
      const ratio = freeFlow > 0 ? Math.min(1.5, median / freeFlow) : 1;
      features.push({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: graph.edgePoints(edge) },
        properties: {
          speedKph: Math.round(median),
          freeFlowKph: Math.round(freeFlow),
          ratio: Math.round(ratio * 100) / 100,
          status:
            ratio >= 0.75 ? 'free' : ratio >= 0.5 ? 'moderate' : ratio >= 0.25 ? 'slow' : 'jammed',
          samples: entry.speeds.length,
          trips: entry.trips.size,
        },
      });
    }
    const result: TrafficFlow = {
      type: 'FeatureCollection',
      windowMinutes: WINDOW_MINUTES,
      generatedAt: new Date().toISOString(),
      features,
    };
    await this.cache.set(key, result, 60);
    this.logger.debug(`Traffic: ${rows.length} fixes, ${features.length} segments`);
    return result;
  }

  async activity(bbox: BoundingBoxQuery): Promise<{
    type: 'FeatureCollection';
    hours: number;
    features: ActivityCell[];
  }> {
    const box = this.validate(bbox);
    const key = `traffic:v1:activity:${box.map((value) => value.toFixed(2)).join(',')}`;
    const cached = await this.cache.get<{
      type: 'FeatureCollection';
      hours: number;
      features: ActivityCell[];
    }>(key);
    if (cached) return cached;
    const rows = await this.prisma.$queryRaw<
      { lon: number; lat: number; samples: bigint; trips: bigint }[]
    >`
      SELECT round(ST_X(location)::numeric, 3)::double precision AS lon,
             round(ST_Y(location)::numeric, 3)::double precision AS lat,
             count(*) AS samples, count(DISTINCT trip_id) AS trips
      FROM trip_points
      WHERE recorded_at >= now() - make_interval(hours => ${ACTIVITY_HOURS})
        AND location && ST_MakeEnvelope(${box[0]}, ${box[1]}, ${box[2]}, ${box[3]}, 4326)
      GROUP BY 1, 2
      HAVING count(DISTINCT trip_id) >= ${MIN_ACTIVITY_TRIPS}
      LIMIT 20000`;
    const result = {
      type: 'FeatureCollection' as const,
      hours: ACTIVITY_HOURS,
      features: rows.map((row): ActivityCell => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [row.lon, row.lat] },
        properties: { trips: Number(row.trips), samples: Number(row.samples) },
      })),
    };
    await this.cache.set(key, result, 300);
    return result;
  }

  private validate(bbox: BoundingBoxQuery): BoundingBoxQuery {
    const [minLng, minLat, maxLng, maxLat] = bbox;
    const valid =
      bbox.length === 4 &&
      bbox.every(Number.isFinite) &&
      minLng >= -180 &&
      maxLng <= 180 &&
      minLat >= -90 &&
      maxLat <= 90 &&
      minLng < maxLng &&
      minLat < maxLat;
    if (!valid) {
      throw new AppException(
        ErrorCode.INVALID_COORDINATES,
        'bbox must be minLng,minLat,maxLng,maxLat',
      );
    }
    if (maxLng - minLng > MAX_SPAN || maxLat - minLat > MAX_SPAN) {
      throw new AppException(
        ErrorCode.INVALID_COORDINATES,
        `bbox must span at most ${MAX_SPAN} degrees`,
      );
    }
    return bbox;
  }
}
