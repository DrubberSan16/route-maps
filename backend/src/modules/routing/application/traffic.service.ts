import { Inject, Injectable, Logger } from '@nestjs/common';
import { CACHE_PROVIDER, type CacheProvider } from '../../../infrastructure/cache/cache.provider';
import { CLASS, NativeGraph } from '../../../infrastructure/native/native-graph';
import {
  NATIVE_GRAPH_STORE,
  type NativeGraphStore,
} from '../../../infrastructure/native/native-graph.store';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AppConfigService } from '../../../config/app-config.service';
import { AppException } from '../../../common/errors/app.exception';
import { ErrorCode } from '../../../common/errors/error-codes';
import { Position } from '../../../common/geo/geojson';
import { NativeRouter } from '../infrastructure/native/native-router';

/**
 * Traffic and activity from the platform's own anonymous trip fixes. Nothing is invented: a road
 * segment only gets a traffic colour when enough fixes from different trips were matched to it,
 * either in the last 15 minutes ("live") or, where there is no live data, on the same kind of day
 * around the same hour over the last four weeks ("typical"). Activity cells need several distinct
 * trips (privacy).
 */

export type BoundingBoxQuery = [number, number, number, number];

export type TrafficStatus = 'free' | 'moderate' | 'slow' | 'jammed';

export interface TrafficFeature {
  type: 'Feature';
  geometry: { type: 'LineString'; coordinates: Position[] };
  properties: {
    speedKph: number;
    freeFlowKph: number;
    ratio: number;
    status: TrafficStatus;
    /** "live": last 15 minutes; "typical": same day type and hour over the last 4 weeks. */
    source: 'live' | 'typical';
    samples: number;
    trips: number;
  };
}

export interface TrafficFlow {
  type: 'FeatureCollection';
  windowMinutes: number;
  typicalWindowDays: number;
  generatedAt: string;
  features: TrafficFeature[];
}

export interface ActivityCell {
  type: 'Feature';
  geometry: { type: 'Point'; coordinates: Position };
  properties: { trips: number; samples: number };
}

interface Fix {
  lon: number;
  lat: number;
  speed: number;
  trip_id: string;
}

interface EdgeSpeed {
  edge: number;
  medianKph: number;
  samples: number;
  trips: number;
}

const WINDOW_MINUTES = 15;
const TYPICAL_DAYS = 28;
const ACTIVITY_HOURS = 24;
const MATCH_METERS = 25;
const MIN_SAMPLES = 3;
const MIN_TRIPS = 2;
/** Typical traffic mixes many days: it needs more distinct trips before it says anything. */
const MIN_TYPICAL_TRIPS = 3;
const MIN_ACTIVITY_TRIPS = 3;
const MAX_FIXES = 50_000;
/** Largest box accepted (degrees): about a province. */
const MAX_SPAN = 2.5;

export const trafficStatus = (ratio: number): TrafficStatus =>
  ratio >= 0.75 ? 'free' : ratio >= 0.5 ? 'moderate' : ratio >= 0.25 ? 'slow' : 'jammed';

@Injectable()
export class TrafficService {
  private readonly logger = new Logger(TrafficService.name);
  private router: { graph: NativeGraph; router: NativeRouter } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(NATIVE_GRAPH_STORE) private readonly graphs: NativeGraphStore,
    @Inject(CACHE_PROVIDER) private readonly cache: CacheProvider,
    private readonly config: AppConfigService,
  ) {}

  async flow(bbox: BoundingBoxQuery): Promise<TrafficFlow> {
    const box = this.validate(bbox);
    const cell = box.map((value) => value.toFixed(2)).join(',');
    const key = `traffic:v2:flow:${cell}`;
    const cached = await this.cache.get<TrafficFlow>(key);
    if (cached) return cached;
    const graph = await this.graphs.get();
    if (this.router?.graph !== graph) this.router = { graph, router: new NativeRouter(graph) };
    const router = this.router.router;

    const live = this.edgeSpeeds(graph, await this.liveFixes(box), MIN_TRIPS);
    const typical = await this.typical(graph, box, cell);
    const features: TrafficFeature[] = [];
    const add = (speed: EdgeSpeed, source: 'live' | 'typical') => {
      const freeFlow = router.speed('CAR', speed.edge);
      const ratio = freeFlow > 0 ? Math.min(1.5, speed.medianKph / freeFlow) : 1;
      features.push({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: graph.edgePoints(speed.edge) },
        properties: {
          speedKph: Math.round(speed.medianKph),
          freeFlowKph: Math.round(freeFlow),
          ratio: Math.round(ratio * 100) / 100,
          status: trafficStatus(ratio),
          source,
          samples: speed.samples,
          trips: speed.trips,
        },
      });
    };
    const measured = new Set<number>();
    for (const speed of live) {
      measured.add(speed.edge);
      add(speed, 'live');
    }
    for (const speed of typical) if (!measured.has(speed.edge)) add(speed, 'typical');

    const result: TrafficFlow = {
      type: 'FeatureCollection',
      windowMinutes: WINDOW_MINUTES,
      typicalWindowDays: TYPICAL_DAYS,
      generatedAt: new Date().toISOString(),
      features,
    };
    await this.cache.set(key, result, 60);
    this.logger.debug(
      `Traffic: ${live.length} live and ${features.length - live.length} typical segments`,
    );
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

  /** Motor-vehicle fixes of the last 15 minutes. */
  private liveFixes(box: BoundingBoxQuery): Promise<Fix[]> {
    return this.prisma.$queryRaw<Fix[]>`
      SELECT ST_X(p.location) AS lon, ST_Y(p.location) AS lat, p.speed, p.trip_id::text AS trip_id
      FROM trip_points p
      JOIN trips t ON t.id = p.trip_id
      WHERE p.recorded_at >= now() - make_interval(mins => ${WINDOW_MINUTES})
        AND p.speed IS NOT NULL AND p.speed >= 0 AND p.speed < 70
        AND (p.accuracy IS NULL OR p.accuracy <= 50)
        AND t.profile IN ('CAR', 'MOTORCYCLE', 'TRUCK')
        AND p.location && ST_MakeEnvelope(${box[0]}, ${box[1]}, ${box[2]}, ${box[3]}, 4326)
      LIMIT ${MAX_FIXES}`;
  }

  /**
   * Speeds on the same kind of day (Monday to Friday, Saturday or Sunday) within an hour of the
   * current local time, over the last four weeks. Cached for 15 minutes: it changes slowly.
   */
  private async typical(
    graph: NativeGraph,
    box: BoundingBoxQuery,
    cell: string,
  ): Promise<EdgeSpeed[]> {
    const zone = this.config.get('traffic').timeZone;
    const key = `traffic:v2:typical:${cell}:${zone}:${this.hourBucket(zone)}`;
    const cached = await this.cache.get<EdgeSpeed[]>(key);
    if (cached) return cached;
    const rows = await this.prisma.$queryRaw<Fix[]>`
      WITH local AS (SELECT (now() AT TIME ZONE ${zone}) AS now_local)
      SELECT ST_X(p.location) AS lon, ST_Y(p.location) AS lat, p.speed, p.trip_id::text AS trip_id
      FROM trip_points p
      JOIN trips t ON t.id = p.trip_id
      CROSS JOIN local
      WHERE p.recorded_at >= now() - make_interval(days => ${TYPICAL_DAYS})
        AND p.recorded_at < now() - make_interval(mins => ${WINDOW_MINUTES})
        AND p.speed IS NOT NULL AND p.speed >= 0 AND p.speed < 70
        AND (p.accuracy IS NULL OR p.accuracy <= 50)
        AND t.profile IN ('CAR', 'MOTORCYCLE', 'TRUCK')
        AND p.location && ST_MakeEnvelope(${box[0]}, ${box[1]}, ${box[2]}, ${box[3]}, 4326)
        AND GREATEST(extract(isodow FROM p.recorded_at AT TIME ZONE ${zone}), 5)
            = GREATEST(extract(isodow FROM local.now_local), 5)
        AND ((extract(hour FROM p.recorded_at AT TIME ZONE ${zone})
              - extract(hour FROM local.now_local) + 24)::int % 24) IN (0, 1, 23)
      LIMIT ${MAX_FIXES}`;
    const speeds = this.edgeSpeeds(graph, rows, MIN_TYPICAL_TRIPS);
    await this.cache.set(key, speeds, 900);
    return speeds;
  }

  /** Median speed of the road segments with enough fixes from enough distinct trips. */
  private edgeSpeeds(graph: NativeGraph, rows: Fix[], minTrips: number): EdgeSpeed[] {
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
    const result: EdgeSpeed[] = [];
    for (const [edge, entry] of perEdge) {
      if (entry.speeds.length < MIN_SAMPLES || entry.trips.size < minTrips) continue;
      const sorted = [...entry.speeds].sort((a, b) => a - b);
      result.push({
        edge,
        medianKph: sorted[Math.floor(sorted.length / 2)],
        samples: sorted.length,
        trips: entry.trips.size,
      });
    }
    return result;
  }

  /** Changes every hour of the local day, so typical traffic follows the clock. */
  private hourBucket(zone: string): string {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      weekday: 'short',
      hour: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(new Date());
    return parts
      .filter((part) => part.type === 'weekday' || part.type === 'hour')
      .map((part) => part.value)
      .join('-');
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
