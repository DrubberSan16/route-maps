import { readFile, stat } from 'node:fs/promises';
import { Logger } from '@nestjs/common';
import { Coordinate, Position, haversineMeters } from '../../../../common/geo/geojson';
import {
  CalculateRouteInput,
  RouteCalculation,
  RouteResult,
  bboxOf,
} from '../../domain/entities/route-result';
import {
  RouteNotFoundError,
  RoutingProfileNotSupportedError,
  RoutingProviderUnavailableError,
} from '../../domain/errors';
import { RoutingProvider } from '../../domain/interfaces/routing-provider';
import { RoutingProfile } from '../../domain/value-objects/routing-profile';

interface Edge {
  to: number;
  meters: number;
  name: string;
}

interface Graph {
  points: Position[];
  edges: Edge[][];
  mtimeMs: number;
}

interface GeoJsonFeature {
  properties?: Record<string, unknown>;
  geometry?: { type?: string; coordinates?: unknown };
}

const PROFILES = ['CAR', 'TRUCK', 'MOTORCYCLE'] as const satisfies readonly RoutingProfile[];
type NativeProfile = (typeof PROFILES)[number];
const SPEED_KPH: Record<NativeProfile, number> = {
  CAR: 60,
  TRUCK: 45,
  MOTORCYCLE: 55,
};
const MAX_SNAP_METERS = 30_000;

const coordinate = ([longitude, latitude]: Position): Coordinate => ({ latitude, longitude });

/** A small binary min-heap used by Dijkstra without any external service or package. */
class MinHeap {
  private readonly values: [number, number][] = [];

  push(value: [number, number]): void {
    this.values.push(value);
    let index = this.values.length - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (this.values[parent][0] <= value[0]) break;
      this.values[index] = this.values[parent];
      index = parent;
    }
    this.values[index] = value;
  }

  pop(): [number, number] | undefined {
    const first = this.values[0];
    const last = this.values.pop();
    if (!first || !last || this.values.length === 0) return first;
    let index = 0;
    while (true) {
      const left = index * 2 + 1;
      const right = left + 1;
      if (left >= this.values.length) break;
      const child =
        right < this.values.length && this.values[right][0] < this.values[left][0] ? right : left;
      if (this.values[child][0] >= last[0]) break;
      this.values[index] = this.values[child];
      index = child;
    }
    this.values[index] = last;
    return first;
  }

  get size(): number {
    return this.values.length;
  }
}

/** Routes entirely in-process over the audited Ecuador state-road snapshot. */
export class NativeRoutingProvider implements RoutingProvider {
  readonly name = 'native';
  private readonly logger = new Logger(NativeRoutingProvider.name);
  private graph: Graph | null = null;
  private loading: Promise<Graph> | null = null;

  constructor(private readonly graphFile: string) {}

  supportedProfiles(): RoutingProfile[] {
    return [...PROFILES];
  }

  async health(): Promise<'up' | 'down'> {
    try {
      const info = await stat(this.graphFile);
      return info.isFile() && info.size > 0 ? 'up' : 'down';
    } catch {
      return 'down';
    }
  }

  async calculateRoute(input: CalculateRouteInput): Promise<RouteCalculation> {
    if (!PROFILES.includes(input.profile as (typeof PROFILES)[number])) {
      throw new RoutingProfileNotSupportedError(input.profile, this.name);
    }
    let graph: Graph;
    try {
      graph = await this.load();
    } catch (error) {
      throw new RoutingProviderUnavailableError('The native road graph could not be loaded', {
        cause: error,
      });
    }
    const stops = [input.origin, ...(input.waypoints ?? []), input.destination];
    const positions: Position[] = [];
    let distanceMeters = 0;
    for (let index = 0; index < stops.length - 1; index += 1) {
      const from = this.nearest(graph, stops[index]);
      const to = this.nearest(graph, stops[index + 1]);
      if (from.distance > MAX_SNAP_METERS || to.distance > MAX_SNAP_METERS) {
        throw new RouteNotFoundError('A point is too far from the official state-road network');
      }
      const leg = this.shortestPath(graph, from.node, to.node);
      if (!leg)
        throw new RouteNotFoundError(
          'The requested points are not connected by the official road network',
        );
      distanceMeters += leg.distance;
      if (positions.length > 0) leg.positions.shift();
      positions.push(...leg.positions);
    }
    if (positions.length < 2) throw new RouteNotFoundError('The route has no usable geometry');
    const speed = SPEED_KPH[input.profile as NativeProfile];
    const durationSeconds = Math.round((distanceMeters / 1000 / speed) * 3600);
    const result: RouteResult = {
      distanceMeters: Math.round(distanceMeters),
      durationSeconds,
      geometry: { type: 'LineString', coordinates: positions },
      bbox: bboxOf(positions),
      steps: [
        {
          instruction: 'Inicia el recorrido por la red vial oficial',
          distanceMeters: 0,
          durationSeconds: 0,
          maneuver: 'DEPART',
          location: positions[0],
          streetNames: [],
          geometryIndex: [0, 0],
        },
        {
          instruction: 'Continúa por la ruta indicada',
          distanceMeters: Math.round(distanceMeters),
          durationSeconds,
          maneuver: 'CONTINUE',
          location: positions[0],
          streetNames: [],
          geometryIndex: [0, positions.length - 1],
        },
        {
          instruction: 'Has llegado al destino',
          distanceMeters: 0,
          durationSeconds: 0,
          maneuver: 'ARRIVE',
          location: positions.at(-1)!,
          streetNames: [],
          geometryIndex: [positions.length - 1, positions.length - 1],
        },
      ],
      hasFerry: false,
    };
    return { primary: result, alternatives: [], provider: this.name };
  }

  private async load(): Promise<Graph> {
    const info = await stat(this.graphFile);
    if (this.graph?.mtimeMs === info.mtimeMs) return this.graph;
    this.loading ??= this.build(info.mtimeMs).finally(() => {
      this.loading = null;
    });
    return this.loading;
  }

  private async build(mtimeMs: number): Promise<Graph> {
    const data = JSON.parse(await readFile(this.graphFile, 'utf8')) as {
      features?: GeoJsonFeature[];
    };
    const points: Position[] = [];
    const edges: Edge[][] = [];
    const ids = new Map<string, number>();
    const node = (point: Position): number => {
      const key = `${point[0].toFixed(4)},${point[1].toFixed(4)}`;
      const existing = ids.get(key);
      if (existing !== undefined) return existing;
      const id = points.length;
      ids.set(key, id);
      points.push(point);
      edges.push([]);
      return id;
    };
    for (const feature of data.features ?? []) {
      const geometry = feature.geometry;
      const lines =
        geometry?.type === 'LineString' ? [geometry.coordinates] : geometry?.coordinates;
      if (!Array.isArray(lines)) continue;
      const name =
        scalarText(feature.properties?.nombre_tra) ??
        scalarText(feature.properties?.codigo_via) ??
        'Ruta oficial';
      for (const value of lines) {
        if (!Array.isArray(value)) continue;
        const line = value.filter(
          (point): point is Position =>
            Array.isArray(point) && Number.isFinite(point[0]) && Number.isFinite(point[1]),
        );
        for (let index = 1; index < line.length; index += 1) {
          const from = node(line[index - 1]);
          const to = node(line[index]);
          if (from === to) continue;
          const meters = haversineMeters(coordinate(points[from]), coordinate(points[to]));
          edges[from].push({ to, meters, name });
          edges[to].push({ to: from, meters, name });
        }
      }
    }
    if (points.length === 0) throw new Error('Native road graph is empty');
    this.graph = { points, edges, mtimeMs };
    this.logger.log(`Native routing graph: ${points.length} vertices from ${this.graphFile}`);
    return this.graph;
  }

  private nearest(graph: Graph, point: Coordinate): { node: number; distance: number } {
    let node = -1;
    let distance = Infinity;
    for (let index = 0; index < graph.points.length; index += 1) {
      const candidate = haversineMeters(point, coordinate(graph.points[index]));
      if (candidate < distance) {
        node = index;
        distance = candidate;
      }
    }
    return { node, distance };
  }

  private shortestPath(
    graph: Graph,
    start: number,
    goal: number,
  ): { positions: Position[]; distance: number } | null {
    const distance = new Float64Array(graph.points.length);
    distance.fill(Infinity);
    const previous = new Int32Array(graph.points.length);
    previous.fill(-1);
    distance[start] = 0;
    const queue = new MinHeap();
    queue.push([0, start]);
    while (queue.size > 0) {
      const [cost, current] = queue.pop()!;
      if (cost !== distance[current]) continue;
      if (current === goal) break;
      for (const edge of graph.edges[current]) {
        const next = cost + edge.meters;
        if (next < distance[edge.to]) {
          distance[edge.to] = next;
          previous[edge.to] = current;
          queue.push([next, edge.to]);
        }
      }
    }
    if (!Number.isFinite(distance[goal])) return null;
    const path: number[] = [];
    for (let current = goal; current !== -1; current = previous[current]) path.push(current);
    path.reverse();
    return { positions: path.map((id) => graph.points[id]), distance: distance[goal] };
  }
}

const scalarText = (value: unknown): string | null =>
  typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
    ? String(value)
    : null;
