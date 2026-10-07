import { readFile } from 'node:fs/promises';

/**
 * Road network of the platform, read from the `graph.bin` produced by the data pipeline
 * (infrastructure/data-tools/lib/mapsdata/network.py):
 *
 *   "RMGRAPH2" | uint32 LE header length | UTF-8 JSON header (padded to 8 bytes) | sections
 *
 * Each section is a little-endian typed array at `dataOffset + offset`. Everything is kept in
 * typed arrays (about 60 MB for the whole country), plus indexes derived from them: node
 * adjacency and a spatial grid of edges at load time, connected networks and edges by street name
 * on first use.
 */

export const ROAD_CLASSES = [
  'motorway',
  'trunk',
  'primary',
  'secondary',
  'tertiary',
  'street',
  'service',
  'track',
  'path',
  'footway',
  'steps',
  'connector',
] as const;
export type RoadClass = (typeof ROAD_CLASSES)[number];

export const CLASS = Object.fromEntries(ROAD_CLASSES.map((name, index) => [name, index])) as Record<
  RoadClass,
  number
>;

export const FLAG_ROUNDABOUT = 1;
export const FLAG_STATE_ROAD = 2;
export const FLAG_UNPAVED = 4;
export const FLAG_TUNNEL = 8;
/** Straight link over a gap of the official data (access road of a town that is not mapped). */
export const FLAG_APPROXIMATE = 16;

export interface ParishInfo {
  code: string;
  parish?: string;
  canton?: string;
  province?: string;
}

interface Section {
  name: string;
  type: 'int32' | 'uint32' | 'float32' | 'uint8';
  offset: number;
  length: number;
}

interface Header {
  format: string;
  version: number;
  classes: string[];
  counts: { nodes: number; edges: number; names: number };
  parishes: ParishInfo[];
  sections: Section[];
  region?: string;
  builtAt?: string;
}

const MAGIC = 'RMGRAPH2';
/** Cell size of the edge grid, in degrees (about 220 m). */
const CELL = 0.002;
const METERS_PER_DEGREE = 111_195.08;

/** Connected networks of the roads of some classes. */
export interface RoadNetworks {
  /** Network of every node, -1 when no road of those classes touches it. */
  component: Int32Array;
  /** The network with the most nodes (the main one of the country), -1 when there is none. */
  largest: number;
}

export interface NearestEdge {
  edge: number;
  /** Distance in meters from the query point to the edge. */
  distance: number;
  /** Position along the edge, 0 at `u`, 1 at `v` (by length). */
  fraction: number;
  /** Snapped point [lng, lat]. */
  point: [number, number];
}

export class NativeGraph {
  readonly nodeCount: number;
  readonly edgeCount: number;
  readonly nodeLon: Float64Array;
  readonly nodeLat: Float64Array;
  readonly edgeU: Int32Array;
  readonly edgeV: Int32Array;
  readonly edgeLength: Float32Array;
  readonly edgeClass: Uint8Array;
  readonly edgeFlags: Uint8Array;
  readonly edgeName: Int32Array;
  readonly edgeRef: Int32Array;
  readonly edgeParish: Int32Array;
  readonly shapeOffset: Uint32Array;
  readonly shapeLon: Int32Array;
  readonly shapeLat: Int32Array;
  readonly names: string[];
  readonly parishes: ParishInfo[];
  readonly region?: string;
  readonly builtAt?: string;
  /** adjacency: for node n, entries adjacency[adjacencyStart[n] .. adjacencyStart[n+1]) = edge*2 + direction. */
  readonly adjacencyStart: Uint32Array;
  readonly adjacency: Int32Array;
  private readonly cellKeys: Float64Array;
  private readonly cellStart: Uint32Array;
  private readonly cellEdges: Int32Array;
  private readonly edgesByName = new Map<number, number[]>();
  private readonly nameIds = new Map<string, number>();
  private readonly networksByClasses = new Map<number, RoadNetworks>();

  private constructor(buffer: Buffer, header: Header, dataOffset: number) {
    const sections = new Map(header.sections.map((section) => [section.name, section]));
    const view = <T>(name: string, Type: new (b: ArrayBuffer, o: number, l: number) => T): T => {
      const section = sections.get(name);
      if (!section) throw new Error(`graph.bin has no section ${name}`);
      const absolute = buffer.byteOffset + dataOffset + section.offset;
      const size = section.type === 'uint8' ? 1 : 4;
      if (absolute % size === 0)
        return new Type(buffer.buffer as ArrayBuffer, absolute, section.length);
      // Unaligned buffer (never produced by readFile of a large file, but be safe).
      const copy = new Uint8Array(section.length * size);
      copy.set(
        buffer.subarray(dataOffset + section.offset, dataOffset + section.offset + copy.length),
      );
      return new Type(copy.buffer, 0, section.length);
    };
    this.nodeCount = header.counts.nodes;
    this.edgeCount = header.counts.edges;
    const lonE7 = view('node_lon', Int32Array);
    const latE7 = view('node_lat', Int32Array);
    this.nodeLon = Float64Array.from(lonE7, (value) => value / 1e7);
    this.nodeLat = Float64Array.from(latE7, (value) => value / 1e7);
    this.edgeU = view('edge_u', Int32Array);
    this.edgeV = view('edge_v', Int32Array);
    this.edgeLength = view('edge_len', Float32Array);
    this.edgeClass = view('edge_cls', Uint8Array);
    this.edgeFlags = view('edge_flags', Uint8Array);
    this.edgeName = view('edge_name', Int32Array);
    this.edgeRef = view('edge_ref', Int32Array);
    this.edgeParish = view('edge_parish', Int32Array);
    this.shapeOffset = view('shape_off', Uint32Array);
    this.shapeLon = view('shape_lon', Int32Array);
    this.shapeLat = view('shape_lat', Int32Array);
    const namesOffset = view('names_off', Uint32Array);
    const namesBlob = view('names', Uint8Array);
    const decoder = new TextDecoder();
    this.names = new Array<string>(header.counts.names);
    for (let index = 0; index < header.counts.names; index += 1) {
      this.names[index] = decoder.decode(
        namesBlob.subarray(namesOffset[index], namesOffset[index + 1]),
      );
      this.nameIds.set(this.names[index], index);
    }
    this.parishes = header.parishes ?? [];
    this.region = header.region;
    this.builtAt = header.builtAt;

    // Adjacency (CSR).
    const degree = new Uint32Array(this.nodeCount + 1);
    for (let edge = 0; edge < this.edgeCount; edge += 1) {
      degree[this.edgeU[edge] + 1] += 1;
      degree[this.edgeV[edge] + 1] += 1;
    }
    for (let node = 0; node < this.nodeCount; node += 1) degree[node + 1] += degree[node];
    this.adjacencyStart = degree;
    this.adjacency = new Int32Array(this.edgeCount * 2);
    const fill = this.adjacencyStart.slice(0, this.nodeCount);
    for (let edge = 0; edge < this.edgeCount; edge += 1) {
      this.adjacency[fill[this.edgeU[edge]]++] = edge * 2;
      this.adjacency[fill[this.edgeV[edge]]++] = edge * 2 + 1;
    }

    // Spatial grid of edges (CSR over sorted cell keys).
    const keys: number[] = [];
    const ids: number[] = [];
    for (let edge = 0; edge < this.edgeCount; edge += 1) {
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      this.forEachPoint(edge, (x, y) => {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      });
      for (let cx = cell(minX); cx <= cell(maxX); cx += 1) {
        for (let cy = cell(minY); cy <= cell(maxY); cy += 1) {
          keys.push(cellKey(cx, cy));
          ids.push(edge);
        }
      }
    }
    const order = Uint32Array.from(keys.keys()).sort(
      (a, b) => keys[a] - keys[b] || ids[a] - ids[b],
    );
    const uniqueKeys: number[] = [];
    const starts: number[] = [];
    this.cellEdges = new Int32Array(order.length);
    order.forEach((position, index) => {
      if (uniqueKeys.length === 0 || uniqueKeys[uniqueKeys.length - 1] !== keys[position]) {
        uniqueKeys.push(keys[position]);
        starts.push(index);
      }
      this.cellEdges[index] = ids[position];
    });
    starts.push(order.length);
    this.cellKeys = Float64Array.from(uniqueKeys);
    this.cellStart = Uint32Array.from(starts);
  }

  static async load(file: string): Promise<NativeGraph> {
    return NativeGraph.parse(await readFile(file));
  }

  static parse(buffer: Buffer): NativeGraph {
    if (buffer.subarray(0, 8).toString('latin1') !== MAGIC) {
      throw new Error('Not a route-maps graph (bad magic)');
    }
    const headerLength = buffer.readUInt32LE(8);
    const header = JSON.parse(buffer.subarray(12, 12 + headerLength).toString('utf8')) as Header;
    if (header.format !== 'route-maps-graph' || header.version !== 2) {
      throw new Error(`Unsupported graph format ${header.format} v${header.version}`);
    }
    const dataOffset = Math.ceil((12 + headerLength) / 8) * 8;
    return new NativeGraph(buffer, header, dataOffset);
  }

  /** Calls fn with every point of the edge from u to v (including both nodes). */
  forEachPoint(edge: number, fn: (lon: number, lat: number) => void): void {
    const u = this.edgeU[edge];
    fn(this.nodeLon[u], this.nodeLat[u]);
    for (let i = this.shapeOffset[edge]; i < this.shapeOffset[edge + 1]; i += 1) {
      fn(this.shapeLon[i] / 1e7, this.shapeLat[i] / 1e7);
    }
    const v = this.edgeV[edge];
    fn(this.nodeLon[v], this.nodeLat[v]);
  }

  /** Points of the edge in travel order ([lng, lat]). */
  edgePoints(edge: number, reverse = false): [number, number][] {
    const points: [number, number][] = [];
    this.forEachPoint(edge, (lon, lat) => points.push([lon, lat]));
    return reverse ? points.reverse() : points;
  }

  nameOf(edge: number): string | null {
    const id = this.edgeName[edge];
    return id >= 0 ? this.names[id] : null;
  }

  refOf(edge: number): string | null {
    const id = this.edgeRef[edge];
    return id >= 0 ? this.names[id] : null;
  }

  parishOf(edge: number): ParishInfo | null {
    const id = this.edgeParish[edge];
    return id >= 0 ? (this.parishes[id] ?? null) : null;
  }

  nameId(label: string): number | undefined {
    return this.nameIds.get(label);
  }

  /** Edges carrying the given street label (lazy index). */
  edgesNamed(nameId: number): number[] {
    if (this.edgesByName.size === 0) {
      for (let edge = 0; edge < this.edgeCount; edge += 1) {
        const id = this.edgeName[edge];
        if (id < 0) continue;
        const list = this.edgesByName.get(id);
        if (list) list.push(edge);
        else this.edgesByName.set(id, [edge]);
      }
    }
    return this.edgesByName.get(nameId) ?? [];
  }

  /**
   * Connected networks of the roads whose class is in `classes` (bit `1 << CLASS[name]` per class),
   * computed once per set: two roads are connected for a mode only through roads it may use.
   */
  networks(classes: number): RoadNetworks {
    let networks = this.networksByClasses.get(classes);
    if (!networks) {
      const [component, largest] = this.components(
        (edge) => ((classes >>> this.edgeClass[edge]) & 1) === 1,
      );
      networks = { component, largest };
      this.networksByClasses.set(classes, networks);
    }
    return networks;
  }

  degree(node: number): number {
    return this.adjacencyStart[node + 1] - this.adjacencyStart[node];
  }

  /**
   * Nearest edges accepted by `accept` within `maxMeters`, closest first (at most `limit`).
   * Rings of grid cells are scanned outwards until enough candidates are closer than the ring.
   */
  nearestEdges(
    lon: number,
    lat: number,
    maxMeters: number,
    accept: (edge: number) => boolean,
    limit = 1,
  ): NearestEdge[] {
    const cx = cell(lon);
    const cy = cell(lat);
    const found = new Map<number, NearestEdge>();
    const kx = METERS_PER_DEGREE * Math.cos((lat * Math.PI) / 180);
    const ringMeters = CELL * METERS_PER_DEGREE * Math.min(1, Math.cos((lat * Math.PI) / 180));
    const maxRing = Math.ceil(maxMeters / ringMeters) + 1;
    for (let ring = 0; ring <= maxRing; ring += 1) {
      for (let dx = -ring; dx <= ring; dx += 1) {
        for (let dy = -ring; dy <= ring; dy += 1) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
          const index = this.findCell(cellKey(cx + dx, cy + dy));
          if (index < 0) continue;
          for (let i = this.cellStart[index]; i < this.cellStart[index + 1]; i += 1) {
            const edge = this.cellEdges[i];
            if (found.has(edge) || !accept(edge)) continue;
            const candidate = this.project(edge, lon, lat, kx);
            if (candidate.distance <= maxMeters) found.set(edge, candidate);
          }
        }
      }
      // Anything in a farther ring is at least (ring) cells away.
      const sorted = [...found.values()].sort((a, b) => a.distance - b.distance);
      if (sorted.length >= limit && sorted[limit - 1].distance <= ring * ringMeters) {
        return sorted.slice(0, limit);
      }
    }
    return [...found.values()].sort((a, b) => a.distance - b.distance).slice(0, limit);
  }

  private project(edge: number, lon: number, lat: number, kx: number): NearestEdge {
    const ky = METERS_PER_DEGREE;
    let best = Infinity;
    let bestAlong = 0;
    let bestPoint: [number, number] = [lon, lat];
    let travelled = 0;
    let previous: [number, number] | null = null;
    this.forEachPoint(edge, (x, y) => {
      if (previous) {
        const ax = (previous[0] - lon) * kx;
        const ay = (previous[1] - lat) * ky;
        const bx = (x - lon) * kx;
        const by = (y - lat) * ky;
        const dx = bx - ax;
        const dy = by - ay;
        const length2 = dx * dx + dy * dy;
        const t = length2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / length2));
        const px = ax + t * dx;
        const py = ay + t * dy;
        const distance = Math.hypot(px, py);
        const segment = Math.sqrt(length2);
        if (distance < best) {
          best = distance;
          bestAlong = travelled + t * segment;
          bestPoint = [previous[0] + t * (x - previous[0]), previous[1] + t * (y - previous[1])];
        }
        travelled += segment;
      }
      previous = [x, y];
    });
    return {
      edge,
      distance: best,
      fraction: travelled > 0 ? bestAlong / travelled : 0,
      point: bestPoint,
    };
  }

  private findCell(key: number): number {
    let low = 0;
    let high = this.cellKeys.length - 1;
    while (low <= high) {
      const middle = (low + high) >> 1;
      const value = this.cellKeys[middle];
      if (value === key) return middle;
      if (value < key) low = middle + 1;
      else high = middle - 1;
    }
    return -1;
  }

  private components(accept: (edge: number) => boolean): [Int32Array, number] {
    const component = new Int32Array(this.nodeCount).fill(-1);
    const stack: number[] = [];
    let next = 0;
    let largest = -1;
    let largestSize = 0;
    for (let start = 0; start < this.nodeCount; start += 1) {
      if (component[start] !== -1) continue;
      let size = 0;
      let touched = false;
      component[start] = next;
      stack.push(start);
      while (stack.length > 0) {
        const node = stack.pop()!;
        size += 1;
        for (let i = this.adjacencyStart[node]; i < this.adjacencyStart[node + 1]; i += 1) {
          const edge = this.adjacency[i] >> 1;
          if (!accept(edge)) continue;
          touched = true;
          const other = (this.adjacency[i] & 1) === 0 ? this.edgeV[edge] : this.edgeU[edge];
          if (component[other] === -1) {
            component[other] = next;
            stack.push(other);
          }
        }
      }
      if (!touched) {
        component[start] = -1;
        continue;
      }
      if (size > largestSize) {
        largestSize = size;
        largest = next;
      }
      next += 1;
    }
    return [component, largest];
  }
}

const cell = (value: number): number => Math.floor(value / CELL);
const cellKey = (cx: number, cy: number): number => (cy + 100_000) * 400_000 + (cx + 200_000);
