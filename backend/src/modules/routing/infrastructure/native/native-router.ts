import {
  CLASS,
  FLAG_APPROXIMATE,
  FLAG_ROUNDABOUT,
  FLAG_STATE_ROAD,
  FLAG_UNPAVED,
  NativeGraph,
  NearestEdge,
} from '../../../../infrastructure/native/native-graph';
import { Coordinate, Position } from '../../../../common/geo/geojson';
import {
  ApproximateSection,
  ManeuverType,
  RouteResult,
  RouteStep,
  bboxOf,
} from '../../domain/entities/route-result';
import { RoutingProfile } from '../../domain/value-objects/routing-profile';

/**
 * Routing on the native road graph: snapping to the nearest usable road, A* on travel time with
 * per-class speeds and intersection delays, alternatives by the penalty method and Spanish (or
 * English) turn-by-turn instructions built from the official street names.
 */

// Speeds in km/h by road class (see ROAD_CLASSES): motorway, trunk, primary, secondary,
// tertiary, street, service, track, path, footway, steps, connector. 0 = not allowed.
const URBAN_SPEEDS: Record<RoutingProfile, number[]> = {
  CAR: [80, 60, 55, 45, 35, 28, 15, 20, 0, 0, 0, 25],
  TRUCK: [70, 50, 45, 38, 30, 22, 10, 15, 0, 0, 0, 20],
  MOTORCYCLE: [80, 60, 55, 45, 35, 28, 15, 20, 0, 0, 0, 25],
  BICYCLE: [0, 18, 18, 17, 16, 15, 13, 12, 12, 6, 0, 12],
  PEDESTRIAN: [0, 5, 5, 5, 5, 5, 5, 4.5, 4.5, 5, 3, 5],
};
/** Open-road speeds of the state network (between towns). */
const STATE_SPEEDS: Record<RoutingProfile, number[]> = {
  // Average speeds of Ecuador's highways, curves, towns and climbs included (not speed limits).
  CAR: [90, 65, 55],
  TRUCK: [75, 52, 45],
  MOTORCYCLE: [85, 62, 52],
  BICYCLE: [20, 18, 16],
  PEDESTRIAN: [4.5, 4.5, 4.5],
};
/** Seconds lost at every urban junction (lights, stops, give way). */
const JUNCTION_DELAY: Record<RoutingProfile, number> = {
  CAR: 3,
  TRUCK: 4,
  MOTORCYCLE: 2,
  BICYCLE: 2,
  PEDESTRIAN: 1,
};
const MOTOR_PROFILES = new Set<RoutingProfile>(['CAR', 'TRUCK', 'MOTORCYCLE']);
/** Road classes a profile may use, one bit per class: speed() is above 0 exactly on them. */
const usableClasses = (profile: RoutingProfile): number =>
  URBAN_SPEEDS[profile].reduce(
    (classes, kph, cls) => (kph > 0 ? classes | (1 << cls) : classes),
    0,
  );
export const NATIVE_PROFILES: RoutingProfile[] = [
  'CAR',
  'TRUCK',
  'MOTORCYCLE',
  'BICYCLE',
  'PEDESTRIAN',
];

/** Points farther than this from any usable road cannot be routed. */
const MAX_SNAP_METERS = 30_000;
/** Candidates considered around each point when the nearest road is in a disconnected fragment. */
const SNAP_CANDIDATE_METERS = 2_000;
const METERS_PER_DEGREE = 111_195.08;
const MAX_SETTLED = 4_000_000;

export class NoRouteError extends Error {}

interface Snap extends NearestEdge {
  component: number;
}

interface Leg {
  /** Traversed edges with direction (0: u->v, 1: v->u); first and last may be partial. */
  edges: { edge: number; reverse: boolean; from: number; to: number }[];
  seconds: number;
  meters: number;
}

export interface RouterOptions {
  language?: string;
}

export class NativeRouter {
  private stamp = 0;
  private marks: Int32Array;
  private cost: Float64Array;
  private via: Int32Array;
  private readonly heap = new Heap();

  constructor(private readonly graph: NativeGraph) {
    this.marks = new Int32Array(graph.nodeCount);
    this.cost = new Float64Array(graph.nodeCount);
    this.via = new Int32Array(graph.nodeCount);
  }

  speed(profile: RoutingProfile, edge: number): number {
    const cls = this.graph.edgeClass[edge];
    const flags = this.graph.edgeFlags[edge];
    let kph = URBAN_SPEEDS[profile][cls] ?? 0;
    if (kph > 0 && flags & FLAG_STATE_ROAD && cls <= CLASS.primary) {
      kph = STATE_SPEEDS[profile][cls];
    }
    if (kph > 0 && flags & FLAG_UNPAVED) kph *= MOTOR_PROFILES.has(profile) ? 0.6 : 0.8;
    // A straight link is shorter than the real access road: count it slowly.
    if (kph > 0 && flags & FLAG_APPROXIMATE) kph *= 0.7;
    return kph;
  }

  private maxSpeed(profile: RoutingProfile): number {
    return Math.max(...URBAN_SPEEDS[profile], ...STATE_SPEEDS[profile]);
  }

  /** Travel seconds of a whole edge, plus the junction delay at the node it arrives to. */
  private edgeSeconds(profile: RoutingProfile, edge: number, fraction = 1): number {
    const kph = this.speed(profile, edge);
    return (this.graph.edgeLength[edge] * fraction) / (kph / 3.6);
  }

  private junctionDelay(profile: RoutingProfile, edge: number, node: number): number {
    if (this.graph.edgeFlags[edge] & FLAG_STATE_ROAD) return 0;
    return this.graph.degree(node) >= 3 ? JUNCTION_DELAY[profile] : 0;
  }

  /**
   * Snaps every stop to a road of one network the profile can travel, so that the legs meet at the
   * stops: the network closest to all of them or, when they have none in common nearby, the main
   * network of the country.
   */
  snapStops(stops: Coordinate[], profile: RoutingProfile): Snap[] {
    const graph = this.graph;
    const { component, largest } = graph.networks(usableClasses(profile));
    const usable = (edge: number) => this.speed(profile, edge) > 0;
    const withComponent = (candidate: NearestEdge): Snap => ({
      ...candidate,
      component: component[graph.edgeU[candidate.edge]],
    });
    // Usable roads near each stop, closest first.
    const nearby = stops.map((point) =>
      graph
        .nearestEdges(point.longitude, point.latitude, SNAP_CANDIDATE_METERS, usable, 12)
        .map(withComponent),
    );
    let best: Snap[] | null = null;
    let bestMeters = Infinity;
    for (const network of new Set(nearby[0].map((snap) => snap.component))) {
      const snaps = nearby.map((candidates) =>
        candidates.find((snap) => snap.component === network),
      );
      if (network < 0 || !snaps.every((snap) => snap !== undefined)) continue;
      const meters = snaps.reduce((sum, snap) => sum + snap.distance, 0);
      if (meters < bestMeters) {
        best = snaps;
        bestMeters = meters;
      }
    }
    if (best) return best;
    // Different fragments (or nothing nearby): use the main network of the country.
    return stops.map((point, index) => {
      const snap =
        nearby[index].find((candidate) => candidate.component === largest) ??
        graph
          .nearestEdges(
            point.longitude,
            point.latitude,
            MAX_SNAP_METERS,
            (edge) => usable(edge) && component[graph.edgeU[edge]] === largest,
            1,
          )
          .map(withComponent)[0];
      if (!snap) {
        const which =
          index === 0 ? 'origin' : index === stops.length - 1 ? 'destination' : `stop ${index}`;
        throw new NoRouteError(
          `The ${which} is more than ${MAX_SNAP_METERS / 1000} km from any road`,
        );
      }
      return snap;
    });
  }

  /** Fastest leg between two snapped points; `penalty` multiplies the cost of some edges. */
  leg(profile: RoutingProfile, from: Snap, to: Snap, penalty?: Map<number, number>): Leg {
    const graph = this.graph;
    const stamp = ++this.stamp;
    if (stamp > 2_000_000_000) {
      this.marks.fill(0);
      this.stamp = 1;
    }
    const marks = this.marks;
    const cost = this.cost;
    const via = this.via;
    const heap = this.heap;
    heap.clear();
    const factor = (edge: number) => penalty?.get(edge) ?? 1;
    const toLon = to.point[0];
    const toLat = to.point[1];
    const kx = METERS_PER_DEGREE * Math.cos((toLat * Math.PI) / 180);
    const inverseSpeed = 3.6 / this.maxSpeed(profile) / 1.001;
    const estimate = (node: number) => {
      const dx = (graph.nodeLon[node] - toLon) * kx;
      const dy = (graph.nodeLat[node] - toLat) * METERS_PER_DEGREE;
      return Math.sqrt(dx * dx + dy * dy) * inverseSpeed;
    };
    const relax = (node: number, value: number, arrivedBy: number) => {
      if (marks[node] === stamp && cost[node] <= value) return;
      marks[node] = stamp;
      cost[node] = value;
      via[node] = arrivedBy;
      heap.push(value + estimate(node), node);
    };
    // Seeds: both ends of the origin edge (arrivedBy = -1 marks a seed; direction encoded below).
    const startEdge = from.edge;
    const seedU = this.edgeSeconds(profile, startEdge, from.fraction) * factor(startEdge);
    const seedV = this.edgeSeconds(profile, startEdge, 1 - from.fraction) * factor(startEdge);
    relax(graph.edgeU[startEdge], seedU, -1);
    relax(graph.edgeV[startEdge], seedV, -2);

    const goal = to.edge;
    const goalU = graph.edgeU[goal];
    const goalV = graph.edgeV[goal];
    const tailU = this.edgeSeconds(profile, goal, to.fraction) * factor(goal);
    const tailV = this.edgeSeconds(profile, goal, 1 - to.fraction) * factor(goal);
    let best = Infinity;
    let bestEnd = -1; // node through which the goal edge is entered
    if (startEdge === goal) {
      best = this.edgeSeconds(profile, goal, Math.abs(to.fraction - from.fraction)) * factor(goal);
      bestEnd = -3;
    }
    let settled = 0;
    while (heap.size > 0) {
      const [key, node] = heap.pop();
      if (key >= best) break;
      const g = cost[node];
      if (key > g + estimate(node) + 1e-9) continue; // stale entry
      if (++settled > MAX_SETTLED) throw new NoRouteError('Route search exceeded its limits');
      if (node === goalU && g + tailU < best) {
        best = g + tailU;
        bestEnd = goalU;
      }
      if (node === goalV && g + tailV < best) {
        best = g + tailV;
        bestEnd = goalV;
      }
      for (let i = graph.adjacencyStart[node]; i < graph.adjacencyStart[node + 1]; i += 1) {
        const entry = graph.adjacency[i];
        const edge = entry >> 1;
        const kph = this.speed(profile, edge);
        if (kph <= 0) continue;
        const other = (entry & 1) === 0 ? graph.edgeV[edge] : graph.edgeU[edge];
        const seconds =
          (graph.edgeLength[edge] / (kph / 3.6) + this.junctionDelay(profile, edge, other)) *
          factor(edge);
        relax(other, g + seconds, entry);
      }
    }
    if (!Number.isFinite(best)) throw new NoRouteError('The points are not connected by roads');

    // Rebuild: edges from the goal back to a seed.
    const edges: Leg['edges'] = [];
    if (bestEnd === -3) {
      const reverse = to.fraction < from.fraction;
      edges.push({ edge: goal, reverse, from: from.fraction, to: to.fraction });
    } else {
      edges.push({
        edge: goal,
        reverse: bestEnd === goalV,
        from: bestEnd === goalU ? 0 : 1,
        to: to.fraction,
      });
      let node = bestEnd;
      while (via[node] >= 0) {
        const entry = via[node];
        const edge = entry >> 1;
        const reverse = (entry & 1) === 1;
        edges.push({ edge, reverse, from: reverse ? 1 : 0, to: reverse ? 0 : 1 });
        node = reverse ? graph.edgeV[edge] : graph.edgeU[edge];
      }
      // Seed: -1 reached u (travelling backwards along the start edge), -2 reached v.
      const reachedU = via[node] === -1;
      edges.push({
        edge: startEdge,
        reverse: reachedU,
        from: from.fraction,
        to: reachedU ? 0 : 1,
      });
      edges.reverse();
    }
    let meters = 0;
    let seconds = 0;
    for (let index = 0; index < edges.length; index += 1) {
      const { edge, from: a, to: b } = edges[index];
      const fraction = Math.abs(b - a);
      meters += graph.edgeLength[edge] * fraction;
      seconds += this.edgeSeconds(profile, edge, fraction);
      if (index < edges.length - 1) {
        const node = edges[index].reverse ? graph.edgeU[edge] : graph.edgeV[edge];
        seconds += this.junctionDelay(profile, edge, node);
      }
    }
    return {
      edges: edges.filter((item) => item.from !== item.to || edges.length === 1),
      seconds,
      meters,
    };
  }

  /** Full route through the stops, with optional alternatives when there are no waypoints. */
  route(
    profile: RoutingProfile,
    stops: Coordinate[],
    alternatives: number,
    options: RouterOptions = {},
  ): { primary: RouteResult; alternatives: RouteResult[] } {
    const snaps = this.snapStops(stops, profile);
    const legs: { leg: Leg; from: Snap; to: Snap }[] = [];
    for (let index = 0; index < snaps.length - 1; index += 1) {
      const from = snaps[index];
      const to = snaps[index + 1];
      legs.push({ leg: this.leg(profile, from, to), from, to });
    }
    const primary = this.result(profile, legs, stops, options);
    const found: RouteResult[] = [];
    if (alternatives > 0 && legs.length === 1) {
      const { from, to, leg } = legs[0];
      const penalty = new Map<number, number>();
      const accepted: Leg[] = [leg];
      for (
        let attempt = 0;
        attempt < alternatives + 2 && found.length < alternatives;
        attempt += 1
      ) {
        for (const item of accepted) {
          for (const { edge } of item.edges) penalty.set(edge, (penalty.get(edge) ?? 1) * 1.6);
        }
        let candidate: Leg;
        try {
          candidate = this.leg(profile, from, to, penalty);
        } catch {
          break;
        }
        if (candidate.seconds > leg.seconds * 1.45) break;
        const shared = Math.max(
          ...accepted.map((other) => sharedMeters(this.graph, other, candidate)),
        );
        if (shared > candidate.meters * 0.7) continue;
        accepted.push(candidate);
        found.push(this.result(profile, [{ leg: candidate, from, to }], stops, options));
      }
    }
    return { primary, alternatives: found };
  }

  // ------------------------------------------------------------ result and instructions

  private result(
    profile: RoutingProfile,
    legs: { leg: Leg; from: Snap; to: Snap }[],
    stops: Coordinate[],
    options: RouterOptions,
  ): RouteResult {
    const english = (options.language ?? 'es').toLowerCase().startsWith('en');
    const coordinates: Position[] = [];
    const steps: RouteStep[] = [];
    const approximate: ApproximateSection[] = [];
    let meters = 0;
    let seconds = 0;
    legs.forEach(({ leg }, legIndex) => {
      const pieces = leg.edges.map((item) => ({
        ...item,
        points: this.slice(item.edge, item.from, item.to),
      }));
      const start = coordinates.length > 0 ? coordinates.length - 1 : 0;
      for (const piece of pieces) {
        const first = Math.max(0, coordinates.length - 1);
        for (const point of piece.points) {
          const last = coordinates[coordinates.length - 1];
          if (!last || last[0] !== point[0] || last[1] !== point[1]) coordinates.push(point);
        }
        if (this.graph.edgeFlags[piece.edge] & FLAG_APPROXIMATE) {
          approximate.push({
            geometryIndex: [first, coordinates.length - 1],
            distanceMeters: Math.round(
              this.graph.edgeLength[piece.edge] * Math.abs(piece.to - piece.from),
            ),
          });
        }
      }
      steps.push(
        ...this.instructions(profile, pieces, start, coordinates, english, legIndex, legs.length),
      );
      meters += leg.meters;
      seconds += leg.seconds;
    });
    if (coordinates.length < 2) {
      const only = coordinates[0] ?? [stops[0].longitude, stops[0].latitude];
      coordinates.splice(0, coordinates.length, only, [only[0] + 1e-7, only[1]]);
    }
    return {
      distanceMeters: Math.round(meters),
      durationSeconds: Math.round(seconds),
      geometry: { type: 'LineString', coordinates },
      bbox: bboxOf(coordinates),
      steps,
      hasFerry: false,
      hasTolls: false,
      ...(approximate.length > 0 ? { approximateSections: approximate } : {}),
    };
  }

  /** Points of an edge between two fractions (in travel order). */
  private slice(edge: number, from: number, to: number): Position[] {
    const points = this.graph.edgePoints(edge);
    const lengths = [0];
    for (let i = 1; i < points.length; i += 1) {
      const [x1, y1] = points[i - 1];
      const [x2, y2] = points[i];
      const kx = METERS_PER_DEGREE * Math.cos((y1 * Math.PI) / 180);
      lengths.push(lengths[i - 1] + Math.hypot((x2 - x1) * kx, (y2 - y1) * METERS_PER_DEGREE));
    }
    const total = lengths[lengths.length - 1] || 1;
    const at = (fraction: number): Position => {
      const target = fraction * total;
      for (let i = 1; i < points.length; i += 1) {
        if (lengths[i] >= target) {
          const span = lengths[i] - lengths[i - 1] || 1;
          const t = (target - lengths[i - 1]) / span;
          return [
            points[i - 1][0] + (points[i][0] - points[i - 1][0]) * t,
            points[i - 1][1] + (points[i][1] - points[i - 1][1]) * t,
          ];
        }
      }
      return points[points.length - 1];
    };
    const low = Math.min(from, to);
    const high = Math.max(from, to);
    const out: Position[] = [at(low)];
    for (let i = 1; i < points.length - 1; i += 1) {
      const position = lengths[i] / total;
      if (position > low && position < high) out.push(points[i]);
    }
    out.push(at(high));
    if (from > to) out.reverse();
    return out.map(([x, y]) => [round(x), round(y)]);
  }

  private instructions(
    profile: RoutingProfile,
    pieces: { edge: number; reverse: boolean; from: number; to: number; points: Position[] }[],
    startIndex: number,
    coordinates: Position[],
    english: boolean,
    legIndex: number,
    legCount: number,
  ): RouteStep[] {
    const graph = this.graph;
    const t = english ? EN : ES;
    // Group pieces into runs on the same road; connectors join the road they lead to.
    interface Run {
      key: string;
      label: string | null;
      cls: number;
      roundabout: boolean;
      meters: number;
      seconds: number;
      points: Position[];
      exits: number;
    }
    const runs: Run[] = [];
    for (const piece of pieces) {
      const edge = piece.edge;
      const fraction = Math.abs(piece.to - piece.from);
      const cls = graph.edgeClass[edge];
      const roundabout = (graph.edgeFlags[edge] & FLAG_ROUNDABOUT) !== 0;
      const label = roadLabel(graph, edge);
      const approximate = (graph.edgeFlags[edge] & FLAG_APPROXIMATE) !== 0;
      const key = approximate
        ? 'approximate'
        : roundabout
          ? 'roundabout'
          : graph.edgeName[edge] >= 0
            ? `n${graph.edgeName[edge]}`
            : graph.edgeRef[edge] >= 0
              ? `r${graph.edgeRef[edge]}`
              : cls === CLASS.connector
                ? ''
                : `c${cls}`;
      const meters = graph.edgeLength[edge] * fraction;
      const seconds = this.edgeSeconds(profile, edge, fraction);
      const last = runs[runs.length - 1];
      if (last && (key === '' || key === last.key)) {
        last.meters += meters;
        last.seconds += seconds;
        last.points.push(...piece.points.slice(1));
        if (roundabout) {
          const node = piece.reverse ? graph.edgeU[edge] : graph.edgeV[edge];
          if (graph.degree(node) >= 3) last.exits += 1;
        }
        continue;
      }
      runs.push({
        key: key || `c${cls}`,
        label,
        cls,
        roundabout,
        meters,
        seconds,
        points: [...piece.points],
        exits:
          roundabout && graph.degree(piece.reverse ? graph.edgeU[edge] : graph.edgeV[edge]) >= 3
            ? 1
            : 0,
      });
    }
    // Very short runs between two runs of the same road are digitising artefacts.
    for (let i = 1; i < runs.length - 1; i += 1) {
      if (runs[i].meters < 25 && runs[i - 1].key === runs[i + 1].key && !runs[i].roundabout) {
        runs[i - 1].meters += runs[i].meters + runs[i + 1].meters;
        runs[i - 1].seconds += runs[i].seconds + runs[i + 1].seconds;
        runs[i - 1].points.push(...runs[i].points.slice(1), ...runs[i + 1].points.slice(1));
        runs.splice(i, 2);
        i -= 1;
      }
    }
    const steps: RouteStep[] = [];
    let index = startIndex;
    const locate = (point: Position) => {
      for (let i = index; i < coordinates.length; i += 1) {
        if (coordinates[i][0] === point[0] && coordinates[i][1] === point[1]) return i;
      }
      return index;
    };
    runs.forEach((run, position) => {
      const begin = locate(run.points[0]);
      const end = locate(run.points[run.points.length - 1]);
      index = begin;
      let maneuver: ManeuverType;
      let instruction: string;
      if (position === 0) {
        maneuver = legIndex === 0 ? 'DEPART' : 'WAYPOINT';
        const heading = t.headings[headingIndex(bearing(run.points, true))];
        instruction =
          legIndex === 0
            ? t.depart(heading, run.label, run.cls)
            : t.continueFromStop(heading, run.label, run.cls);
      } else if (run.roundabout) {
        maneuver = 'ROUNDABOUT_ENTER';
        const next = runs[position + 1];
        instruction = t.roundabout(
          Math.max(1, run.exits),
          next?.label ?? null,
          next?.cls ?? run.cls,
        );
      } else {
        const previous = runs[position - 1];
        if (previous.roundabout) {
          maneuver = 'ROUNDABOUT_EXIT';
          instruction = t.follow(run.label, run.cls);
        } else if (run.key === 'approximate') {
          maneuver = 'OTHER';
          instruction = t.approximate(run.meters);
        } else {
          const angle = turnAngle(previous.points, run.points);
          maneuver = turnType(angle);
          instruction = t.turn(maneuver, run.label, run.cls);
        }
      }
      steps.push({
        instruction,
        distanceMeters: Math.round(run.meters),
        durationSeconds: Math.round(run.seconds),
        maneuver,
        location: run.points[0],
        streetNames: run.label ? [run.label] : [],
        geometryIndex: [begin, Math.max(begin, end)],
      });
    });
    const final = coordinates[coordinates.length - 1];
    steps.push({
      instruction: legIndex === legCount - 1 ? t.arrive : t.stop(legIndex + 1),
      distanceMeters: 0,
      durationSeconds: 0,
      maneuver: legIndex === legCount - 1 ? 'ARRIVE' : 'WAYPOINT',
      location: final,
      streetNames: [],
      geometryIndex: [coordinates.length - 1, coordinates.length - 1],
    });
    return steps;
  }
}

// ---------------------------------------------------------------- helpers

const round = (value: number) => Math.round(value * 1e6) / 1e6;

function sharedMeters(graph: NativeGraph, a: Leg, b: Leg): number {
  const edges = new Set(a.edges.map((item) => item.edge));
  let meters = 0;
  for (const item of b.edges) {
    if (edges.has(item.edge)) meters += graph.edgeLength[item.edge] * Math.abs(item.to - item.from);
  }
  return meters;
}

function roadLabel(graph: NativeGraph, edge: number): string | null {
  const name = graph.nameOf(edge);
  const ref = graph.refOf(edge);
  if (graph.edgeFlags[edge] & FLAG_STATE_ROAD) {
    if (ref && name) return `${ref} (${name})`;
    return ref ?? name;
  }
  if (name && ref && !name.includes(ref)) return `${name} (${ref})`;
  return name ?? ref;
}

/** Bearing (degrees from north) of the first or last ~25 m of a polyline. */
function bearing(points: Position[], start: boolean): number {
  const ordered = start ? points : [...points].reverse();
  const origin = ordered[0];
  let target = ordered[ordered.length - 1];
  let travelled = 0;
  for (let i = 1; i < ordered.length; i += 1) {
    const kx = METERS_PER_DEGREE * Math.cos((ordered[i][1] * Math.PI) / 180);
    travelled += Math.hypot(
      (ordered[i][0] - ordered[i - 1][0]) * kx,
      (ordered[i][1] - ordered[i - 1][1]) * METERS_PER_DEGREE,
    );
    target = ordered[i];
    if (travelled >= 25) break;
  }
  const kx = Math.cos((origin[1] * Math.PI) / 180);
  const angle = (Math.atan2((target[0] - origin[0]) * kx, target[1] - origin[1]) * 180) / Math.PI;
  return start ? (angle + 360) % 360 : (angle + 540) % 360;
}

function turnAngle(incoming: Position[], outgoing: Position[]): number {
  const before = bearing(incoming, false);
  const after = bearing(outgoing, true);
  let angle = after - before;
  while (angle > 180) angle -= 360;
  while (angle <= -180) angle += 360;
  return angle;
}

function turnType(angle: number): ManeuverType {
  const size = Math.abs(angle);
  if (size < 20) return 'CONTINUE';
  const right = angle > 0;
  if (size < 45) return right ? 'SLIGHT_RIGHT' : 'SLIGHT_LEFT';
  if (size < 135) return right ? 'TURN_RIGHT' : 'TURN_LEFT';
  if (size < 170) return right ? 'SHARP_RIGHT' : 'SHARP_LEFT';
  return 'UTURN';
}

function headingIndex(degrees: number): number {
  return Math.round(degrees / 45) % 8;
}

interface Phrases {
  headings: string[];
  depart: (heading: string, label: string | null, cls: number) => string;
  continueFromStop: (heading: string, label: string | null, cls: number) => string;
  turn: (maneuver: ManeuverType, label: string | null, cls: number) => string;
  follow: (label: string | null, cls: number) => string;
  roundabout: (exit: number, label: string | null, cls: number) => string;
  arrive: string;
  stop: (index: number) => string;
  approximate: (meters: number) => string;
}

const kilometers = (meters: number, decimal: string) =>
  meters >= 1000
    ? `${(meters / 1000).toFixed(1).replace('.', decimal)} km`
    : `${Math.round(meters)} m`;

const unnamedEs = (cls: number) =>
  cls === CLASS.service
    ? 'el pasaje'
    : cls === CLASS.track
      ? 'el camino'
      : cls >= CLASS.path && cls <= CLASS.steps
        ? 'el paso peatonal'
        : cls <= CLASS.primary
          ? 'la vía'
          : 'la calle';
const unnamedEn = (cls: number) =>
  cls === CLASS.service
    ? 'the lane'
    : cls === CLASS.track
      ? 'the track'
      : cls >= CLASS.path && cls <= CLASS.steps
        ? 'the footpath'
        : 'the road';

const ORDINAL_ES = [
  'primera',
  'segunda',
  'tercera',
  'cuarta',
  'quinta',
  'sexta',
  'séptima',
  'octava',
];
const ORDINAL_EN = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth'];

const ES: Phrases = {
  headings: ['norte', 'noreste', 'este', 'sureste', 'sur', 'suroeste', 'oeste', 'noroeste'],
  depart: (heading, label, cls) => `Dirígete al ${heading} por ${label ?? unnamedEs(cls)}`,
  continueFromStop: (heading, label, cls) =>
    `Desde la parada, dirígete al ${heading} por ${label ?? unnamedEs(cls)}`,
  turn: (maneuver, label, cls) => {
    const road = label ?? unnamedEs(cls);
    switch (maneuver) {
      case 'CONTINUE':
        return `Continúa por ${road}`;
      case 'SLIGHT_RIGHT':
        return `Gira levemente a la derecha hacia ${road}`;
      case 'SLIGHT_LEFT':
        return `Gira levemente a la izquierda hacia ${road}`;
      case 'TURN_RIGHT':
        return `Gira a la derecha en ${road}`;
      case 'TURN_LEFT':
        return `Gira a la izquierda en ${road}`;
      case 'SHARP_RIGHT':
        return `Gira fuertemente a la derecha en ${road}`;
      case 'SHARP_LEFT':
        return `Gira fuertemente a la izquierda en ${road}`;
      case 'UTURN':
        return `Da la vuelta en U por ${road}`;
      default:
        return `Continúa por ${road}`;
    }
  },
  follow: (label, cls) => `Sal del redondel por ${label ?? unnamedEs(cls)}`,
  roundabout: (exit, label, cls) =>
    `En el redondel, toma la ${ORDINAL_ES[Math.min(exit, 8) - 1] ?? `${exit}.ª`} salida hacia ${
      label ?? unnamedEs(cls)
    }`,
  arrive: 'Llegaste a tu destino',
  stop: (index) => `Llegaste a la parada ${index}`,
  approximate: (meters) =>
    `Continúa por el acceso local (tramo aproximado de ${kilometers(meters, ',')}, sin vía registrada)`,
};

const EN: Phrases = {
  headings: ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'],
  depart: (heading, label, cls) => `Head ${heading} on ${label ?? unnamedEn(cls)}`,
  continueFromStop: (heading, label, cls) =>
    `From the stop, head ${heading} on ${label ?? unnamedEn(cls)}`,
  turn: (maneuver, label, cls) => {
    const road = label ?? unnamedEn(cls);
    switch (maneuver) {
      case 'CONTINUE':
        return `Continue on ${road}`;
      case 'SLIGHT_RIGHT':
        return `Bear right onto ${road}`;
      case 'SLIGHT_LEFT':
        return `Bear left onto ${road}`;
      case 'TURN_RIGHT':
        return `Turn right onto ${road}`;
      case 'TURN_LEFT':
        return `Turn left onto ${road}`;
      case 'SHARP_RIGHT':
        return `Make a sharp right onto ${road}`;
      case 'SHARP_LEFT':
        return `Make a sharp left onto ${road}`;
      case 'UTURN':
        return `Make a U-turn on ${road}`;
      default:
        return `Continue on ${road}`;
    }
  },
  follow: (label, cls) => `Exit the roundabout onto ${label ?? unnamedEn(cls)}`,
  roundabout: (exit, label, cls) =>
    `At the roundabout, take the ${ORDINAL_EN[Math.min(exit, 8) - 1] ?? `${exit}th`} exit onto ${
      label ?? unnamedEn(cls)
    }`,
  arrive: 'You have arrived at your destination',
  stop: (index) => `You have arrived at stop ${index}`,
  approximate: (meters) =>
    `Continue on the local access road (approximate stretch of ${kilometers(meters, '.')}, not mapped)`,
};

/** Binary min-heap of (key, node) over growable typed arrays. */
class Heap {
  private keys = new Float64Array(1024);
  private values = new Int32Array(1024);
  size = 0;

  clear(): void {
    this.size = 0;
  }

  push(key: number, value: number): void {
    if (this.size === this.keys.length) {
      const keys = new Float64Array(this.keys.length * 2);
      keys.set(this.keys);
      this.keys = keys;
      const values = new Int32Array(this.values.length * 2);
      values.set(this.values);
      this.values = values;
    }
    let index = this.size++;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (this.keys[parent] <= key) break;
      this.keys[index] = this.keys[parent];
      this.values[index] = this.values[parent];
      index = parent;
    }
    this.keys[index] = key;
    this.values[index] = value;
  }

  pop(): [number, number] {
    const key = this.keys[0];
    const value = this.values[0];
    const lastKey = this.keys[--this.size];
    const lastValue = this.values[this.size];
    let index = 0;
    while (true) {
      const left = index * 2 + 1;
      if (left >= this.size) break;
      const right = left + 1;
      const child = right < this.size && this.keys[right] < this.keys[left] ? right : left;
      if (this.keys[child] >= lastKey) break;
      this.keys[index] = this.keys[child];
      this.values[index] = this.values[child];
      index = child;
    }
    this.keys[index] = lastKey;
    this.values[index] = lastValue;
    return [key, value];
  }
}
