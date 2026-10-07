import 'dart:math' as math;
import 'dart:typed_data';

import 'js_math.dart';
import 'road_graph.dart';

/// Routing on the road network of an offline pack: the backend's `NativeRouter`
/// (native-router.ts) step by step, so that a route calculated on the phone is the route the
/// server gives for the same points: snapping to the nearest usable road, A* on travel time with
/// per-class speeds and junction delays, alternatives by the penalty method and Spanish (or
/// English) turn-by-turn instructions with the official street names.
///
/// Results are the JSON of the backend's `RouteResult`.

/// A point to route through.
typedef Stop = ({double longitude, double latitude});

/// No route between the points (the backend's `NoRouteError`, with its messages).
class NoRouteError implements Exception {
  const NoRouteError(this.message);

  final String message;

  @override
  String toString() => message;
}

/// Profiles of the native engine.
const nativeProfiles = ['CAR', 'TRUCK', 'MOTORCYCLE', 'BICYCLE', 'PEDESTRIAN'];

// Speeds in km/h by road class (see RoadClass): motorway, trunk, primary, secondary, tertiary,
// street, service, track, path, footway, steps, connector. 0 = not allowed.
const _urbanSpeeds = <String, List<double>>{
  'CAR': [80, 60, 55, 45, 35, 28, 15, 20, 0, 0, 0, 25],
  'TRUCK': [70, 50, 45, 38, 30, 22, 10, 15, 0, 0, 0, 20],
  'MOTORCYCLE': [80, 60, 55, 45, 35, 28, 15, 20, 0, 0, 0, 25],
  'BICYCLE': [0, 18, 18, 17, 16, 15, 13, 12, 12, 6, 0, 12],
  'PEDESTRIAN': [0, 5, 5, 5, 5, 5, 5, 4.5, 4.5, 5, 3, 5],
};

/// Open-road speeds of the state network (between towns).
const _stateSpeeds = <String, List<double>>{
  'CAR': [90, 65, 55],
  'TRUCK': [75, 52, 45],
  'MOTORCYCLE': [85, 62, 52],
  'BICYCLE': [20, 18, 16],
  'PEDESTRIAN': [4.5, 4.5, 4.5],
};

/// Seconds lost at every urban junction (lights, stops, give way).
const _junctionDelays = <String, double>{
  'CAR': 3,
  'TRUCK': 4,
  'MOTORCYCLE': 2,
  'BICYCLE': 2,
  'PEDESTRIAN': 1,
};
const _motorProfiles = {'CAR', 'TRUCK', 'MOTORCYCLE'};

/// Points farther than this from any usable road cannot be routed.
const _maxSnapMeters = 30000;

/// Candidates considered around each point when the nearest road is in a disconnected fragment.
const _snapCandidateMeters = 2000.0;
const _maxSettled = 4000000;

/// Speeds of one profile.
class _Mode {
  _Mode(String profile)
    : urban = _urbanSpeeds[profile] ?? (throw ArgumentError.value(profile, 'profile')),
      state = _stateSpeeds[profile]!,
      junction = _junctionDelays[profile]!,
      motor = _motorProfiles.contains(profile);

  final List<double> urban;
  final List<double> state;
  final double junction;
  final bool motor;

  late final double maxSpeed = [...urban, ...state].reduce(math.max);

  /// Road classes the profile may use, one bit per class: speed() is above 0 exactly on them.
  late final int classes = () {
    var classes = 0;
    for (var cls = 0; cls < urban.length; cls += 1) {
      if (urban[cls] > 0) classes |= 1 << cls;
    }
    return classes;
  }();
}

class _Snap {
  _Snap(NearestEdge nearest, this.component)
    : edge = nearest.edge,
      distance = nearest.distance,
      fraction = nearest.fraction,
      point = nearest.point;

  final int edge;
  final double distance;
  final double fraction;
  final List<double> point;
  final int component;
}

/// A traversed edge with direction (reverse: v to u); the first and last may be partial.
class _Traversal {
  const _Traversal(this.edge, this.reverse, this.from, this.to);

  final int edge;
  final bool reverse;
  final double from;
  final double to;
}

class _Leg {
  const _Leg(this.edges, this.seconds, this.meters);

  final List<_Traversal> edges;
  final double seconds;
  final double meters;
}

class _Piece {
  _Piece(_Traversal traversal, this.points)
    : edge = traversal.edge,
      reverse = traversal.reverse,
      from = traversal.from,
      to = traversal.to;

  final int edge;
  final bool reverse;
  final double from;
  final double to;
  final List<List<double>> points;
}

/// Pieces on the same road, for one instruction.
class _Run {
  _Run({
    required this.key,
    required this.label,
    required this.cls,
    required this.roundabout,
    required this.meters,
    required this.seconds,
    required this.points,
    required this.exits,
  });

  final String key;
  final String? label;
  final int cls;
  final bool roundabout;
  double meters;
  double seconds;
  final List<List<double>> points;
  int exits;
}

class RoadRouter {
  RoadRouter(this.graph)
    : _marks = Int32List(graph.nodeCount),
      _cost = Float64List(graph.nodeCount),
      _via = Int32List(graph.nodeCount);

  final RoadGraph graph;
  var _stamp = 0;
  final Int32List _marks;
  final Float64List _cost;
  final Int32List _via;
  final _heap = _Heap();

  double _speed(_Mode mode, int edge) {
    final cls = graph.edgeClass[edge];
    final flags = graph.edgeFlags[edge];
    var kph = cls < mode.urban.length ? mode.urban[cls] : 0.0;
    if (kph > 0 && (flags & RoadFlags.stateRoad) != 0 && cls <= RoadClass.primary) {
      kph = mode.state[cls];
    }
    if (kph > 0 && (flags & RoadFlags.unpaved) != 0) kph *= mode.motor ? 0.6 : 0.8;
    // A straight link is shorter than the real access road: count it slowly.
    if (kph > 0 && (flags & RoadFlags.approximate) != 0) kph *= 0.7;
    return kph;
  }

  /// Travel seconds of a part of an edge.
  double _edgeSeconds(_Mode mode, int edge, [double fraction = 1]) {
    final kph = _speed(mode, edge);
    return (graph.edgeLength[edge] * fraction) / (kph / 3.6);
  }

  double _junctionDelay(_Mode mode, int edge, int node) {
    if ((graph.edgeFlags[edge] & RoadFlags.stateRoad) != 0) return 0;
    return graph.degree(node) >= 3 ? mode.junction : 0;
  }

  /// Snaps every stop to a road of one network the profile can travel, so that the legs meet at
  /// the stops: the network closest to all of them or, when they have none in common nearby, the
  /// main network of the region.
  List<_Snap> _snapStops(List<Stop> stops, _Mode mode) {
    final networks = graph.networks(mode.classes);
    final component = networks.component;
    final largest = networks.largest;
    bool usable(int edge) => _speed(mode, edge) > 0;
    _Snap withComponent(NearestEdge candidate) =>
        _Snap(candidate, component[graph.edgeU[candidate.edge]]);
    // Usable roads near each stop, closest first.
    final nearby = [
      for (final stop in stops)
        [
          for (final candidate in graph.nearestEdges(
            stop.longitude,
            stop.latitude,
            _snapCandidateMeters,
            usable,
            limit: 12,
          ))
            withComponent(candidate),
        ],
    ];
    List<_Snap>? best;
    var bestMeters = double.infinity;
    for (final network in {for (final snap in nearby[0]) snap.component}) {
      final snaps = [
        for (final candidates in nearby) _find(candidates, (snap) => snap.component == network),
      ];
      if (network < 0 || snaps.any((snap) => snap == null)) continue;
      var meters = 0.0;
      for (final snap in snaps) {
        meters += snap!.distance;
      }
      if (meters < bestMeters) {
        best = [for (final snap in snaps) snap!];
        bestMeters = meters;
      }
    }
    if (best != null) return best;
    // Different fragments (or nothing nearby): use the main network of the region.
    return [
      for (var index = 0; index < stops.length; index += 1)
        _find(nearby[index], (candidate) => candidate.component == largest) ??
            _fallbackSnap(stops, index, usable, component, largest, withComponent),
    ];
  }

  _Snap _fallbackSnap(
    List<Stop> stops,
    int index,
    bool Function(int edge) usable,
    Int32List component,
    int largest,
    _Snap Function(NearestEdge candidate) withComponent,
  ) {
    final stop = stops[index];
    final candidates = graph.nearestEdges(
      stop.longitude,
      stop.latitude,
      _maxSnapMeters.toDouble(),
      (edge) => usable(edge) && component[graph.edgeU[edge]] == largest,
    );
    if (candidates.isEmpty) {
      final which = index == 0
          ? 'origin'
          : index == stops.length - 1
          ? 'destination'
          : 'stop $index';
      throw NoRouteError('The $which is more than ${_maxSnapMeters ~/ 1000} km from any road');
    }
    return withComponent(candidates.first);
  }

  /// Fastest leg between two snapped points; [penalty] multiplies the cost of some edges.
  _Leg _leg(_Mode mode, _Snap from, _Snap to, [Map<int, double>? penalty]) {
    final stamp = ++_stamp;
    if (stamp > 2000000000) {
      _marks.fillRange(0, _marks.length, 0);
      _stamp = 1;
    }
    final marks = _marks;
    final cost = _cost;
    final via = _via;
    final heap = _heap..clear();
    double factor(int edge) => penalty?[edge] ?? 1;
    final toLon = to.point[0];
    final toLat = to.point[1];
    final kx = metersPerDegree * math.cos((toLat * math.pi) / 180);
    final inverseSpeed = 3.6 / mode.maxSpeed / 1.001;
    double estimate(int node) {
      final dx = (graph.nodeLon[node] - toLon) * kx;
      final dy = (graph.nodeLat[node] - toLat) * metersPerDegree;
      return math.sqrt(dx * dx + dy * dy) * inverseSpeed;
    }

    void relax(int node, double value, int arrivedBy) {
      if (marks[node] == stamp && cost[node] <= value) return;
      marks[node] = stamp;
      cost[node] = value;
      via[node] = arrivedBy;
      heap.push(value + estimate(node), node);
    }

    // Seeds: both ends of the origin edge (arrivedBy -1 reached u, -2 reached v).
    final startEdge = from.edge;
    final seedU = _edgeSeconds(mode, startEdge, from.fraction) * factor(startEdge);
    final seedV = _edgeSeconds(mode, startEdge, 1 - from.fraction) * factor(startEdge);
    relax(graph.edgeU[startEdge], seedU, -1);
    relax(graph.edgeV[startEdge], seedV, -2);

    final goal = to.edge;
    final goalU = graph.edgeU[goal];
    final goalV = graph.edgeV[goal];
    final tailU = _edgeSeconds(mode, goal, to.fraction) * factor(goal);
    final tailV = _edgeSeconds(mode, goal, 1 - to.fraction) * factor(goal);
    var best = double.infinity;
    var bestEnd = -1; // node through which the goal edge is entered
    if (startEdge == goal) {
      best = _edgeSeconds(mode, goal, (to.fraction - from.fraction).abs()) * factor(goal);
      bestEnd = -3;
    }
    var settled = 0;
    while (heap.size > 0) {
      final node = heap.pop();
      final key = heap.poppedKey;
      if (key >= best) break;
      final g = cost[node];
      if (key > g + estimate(node) + 1e-9) continue; // stale entry
      if (++settled > _maxSettled) throw const NoRouteError('Route search exceeded its limits');
      if (node == goalU && g + tailU < best) {
        best = g + tailU;
        bestEnd = goalU;
      }
      if (node == goalV && g + tailV < best) {
        best = g + tailV;
        bestEnd = goalV;
      }
      for (var i = graph.adjacencyStart[node]; i < graph.adjacencyStart[node + 1]; i += 1) {
        final entry = graph.adjacency[i];
        final edge = entry >> 1;
        final kph = _speed(mode, edge);
        if (kph <= 0) continue;
        final other = (entry & 1) == 0 ? graph.edgeV[edge] : graph.edgeU[edge];
        final seconds =
            (graph.edgeLength[edge] / (kph / 3.6) + _junctionDelay(mode, edge, other)) *
            factor(edge);
        relax(other, g + seconds, entry);
      }
    }
    if (!best.isFinite) throw const NoRouteError('The points are not connected by roads');

    // Rebuild: edges from the goal back to a seed.
    final edges = <_Traversal>[];
    if (bestEnd == -3) {
      final reverse = to.fraction < from.fraction;
      edges.add(_Traversal(goal, reverse, from.fraction, to.fraction));
    } else {
      edges.add(_Traversal(goal, bestEnd == goalV, bestEnd == goalU ? 0 : 1, to.fraction));
      var node = bestEnd;
      while (via[node] >= 0) {
        final entry = via[node];
        final edge = entry >> 1;
        final reverse = (entry & 1) == 1;
        edges.add(_Traversal(edge, reverse, reverse ? 1 : 0, reverse ? 0 : 1));
        node = reverse ? graph.edgeV[edge] : graph.edgeU[edge];
      }
      // Seed: -1 reached u (travelling backwards along the start edge), -2 reached v.
      final reachedU = via[node] == -1;
      edges.add(_Traversal(startEdge, reachedU, from.fraction, reachedU ? 0 : 1));
    }
    final ordered = bestEnd == -3 ? edges : edges.reversed.toList();
    var meters = 0.0;
    var seconds = 0.0;
    for (var index = 0; index < ordered.length; index += 1) {
      final item = ordered[index];
      final fraction = (item.to - item.from).abs();
      meters += graph.edgeLength[item.edge] * fraction;
      seconds += _edgeSeconds(mode, item.edge, fraction);
      if (index < ordered.length - 1) {
        final node = item.reverse ? graph.edgeU[item.edge] : graph.edgeV[item.edge];
        seconds += _junctionDelay(mode, item.edge, node);
      }
    }
    return _Leg(
      [
        for (final item in ordered)
          if (item.from != item.to || ordered.length == 1) item,
      ],
      seconds,
      meters,
    );
  }

  /// Full route through the stops, with optional alternatives when there are no waypoints:
  /// the backend's `RouteResult` JSON of the primary route and of each alternative.
  ({Map<String, Object?> primary, List<Map<String, Object?>> alternatives}) route(
    String profile,
    List<Stop> stops,
    int alternatives, {
    String? language,
  }) {
    final mode = _Mode(profile);
    final snaps = _snapStops(stops, mode);
    final legs = <({_Leg leg, _Snap from, _Snap to})>[];
    for (var index = 0; index < snaps.length - 1; index += 1) {
      final from = snaps[index];
      final to = snaps[index + 1];
      legs.add((leg: _leg(mode, from, to), from: from, to: to));
    }
    final primary = _result(mode, [for (final item in legs) item.leg], stops, language);
    final found = <Map<String, Object?>>[];
    if (alternatives > 0 && legs.length == 1) {
      final (:leg, :from, :to) = legs[0];
      final penalty = <int, double>{};
      final accepted = [leg];
      for (
        var attempt = 0;
        attempt < alternatives + 2 && found.length < alternatives;
        attempt += 1
      ) {
        for (final item in accepted) {
          for (final traversal in item.edges) {
            penalty[traversal.edge] = (penalty[traversal.edge] ?? 1) * 1.6;
          }
        }
        _Leg candidate;
        try {
          candidate = _leg(mode, from, to, penalty);
        } on NoRouteError {
          break;
        }
        if (candidate.seconds > leg.seconds * 1.45) break;
        final shared = accepted.map((other) => _sharedMeters(other, candidate)).reduce(math.max);
        if (shared > candidate.meters * 0.7) continue;
        accepted.add(candidate);
        found.add(_result(mode, [candidate], stops, language));
      }
    }
    return (primary: primary, alternatives: found);
  }

  double _sharedMeters(_Leg a, _Leg b) {
    final edges = {for (final item in a.edges) item.edge};
    var meters = 0.0;
    for (final item in b.edges) {
      if (edges.contains(item.edge)) {
        meters += graph.edgeLength[item.edge] * (item.to - item.from).abs();
      }
    }
    return meters;
  }

  // ------------------------------------------------------------ result and instructions

  Map<String, Object?> _result(_Mode mode, List<_Leg> legs, List<Stop> stops, String? language) {
    final english = (language ?? 'es').toLowerCase().startsWith('en');
    final coordinates = <List<double>>[];
    final steps = <Map<String, Object?>>[];
    final approximate = <Map<String, Object?>>[];
    var meters = 0.0;
    var seconds = 0.0;
    for (var legIndex = 0; legIndex < legs.length; legIndex += 1) {
      final leg = legs[legIndex];
      final pieces = [
        for (final item in leg.edges) _Piece(item, _slice(item.edge, item.from, item.to)),
      ];
      final start = coordinates.isNotEmpty ? coordinates.length - 1 : 0;
      for (final piece in pieces) {
        final first = math.max(0, coordinates.length - 1);
        for (final point in piece.points) {
          final last = coordinates.isEmpty ? null : coordinates.last;
          if (last == null || last[0] != point[0] || last[1] != point[1]) coordinates.add(point);
        }
        if ((graph.edgeFlags[piece.edge] & RoadFlags.approximate) != 0) {
          approximate.add({
            'geometryIndex': [first, coordinates.length - 1],
            'distanceMeters': jsRoundInt(
              graph.edgeLength[piece.edge] * (piece.to - piece.from).abs(),
            ),
          });
        }
      }
      steps.addAll(_instructions(mode, pieces, start, coordinates, english, legIndex, legs.length));
      meters += leg.meters;
      seconds += leg.seconds;
    }
    if (coordinates.length < 2) {
      final only = coordinates.isNotEmpty
          ? coordinates[0]
          : [stops[0].longitude, stops[0].latitude];
      coordinates
        ..clear()
        ..add(only)
        ..add([only[0] + 1e-7, only[1]]);
    }
    return {
      'distanceMeters': jsRoundInt(meters),
      'durationSeconds': jsRoundInt(seconds),
      'geometry': {'type': 'LineString', 'coordinates': coordinates},
      'bbox': _bboxOf(coordinates),
      'steps': steps,
      'hasFerry': false,
      'hasTolls': false,
      if (approximate.isNotEmpty) 'approximateSections': approximate,
    };
  }

  /// Points of an edge between two fractions (in travel order).
  List<List<double>> _slice(int edge, double from, double to) {
    final points = graph.edgePoints(edge);
    final lengths = <double>[0];
    for (var i = 1; i < points.length; i += 1) {
      final x1 = points[i - 1][0];
      final y1 = points[i - 1][1];
      final x2 = points[i][0];
      final y2 = points[i][1];
      final kx = metersPerDegree * math.cos((y1 * math.pi) / 180);
      lengths.add(lengths[i - 1] + jsHypot((x2 - x1) * kx, (y2 - y1) * metersPerDegree));
    }
    final total = _orOne(lengths.last);
    List<double> at(double fraction) {
      final target = fraction * total;
      for (var i = 1; i < points.length; i += 1) {
        if (lengths[i] >= target) {
          final span = _orOne(lengths[i] - lengths[i - 1]);
          final t = (target - lengths[i - 1]) / span;
          return [
            points[i - 1][0] + (points[i][0] - points[i - 1][0]) * t,
            points[i - 1][1] + (points[i][1] - points[i - 1][1]) * t,
          ];
        }
      }
      return points.last;
    }

    final low = math.min(from, to);
    final high = math.max(from, to);
    final out = [at(low)];
    for (var i = 1; i < points.length - 1; i += 1) {
      final position = lengths[i] / total;
      if (position > low && position < high) out.add(points[i]);
    }
    out.add(at(high));
    final ordered = from > to ? out.reversed : out;
    return [
      for (final point in ordered) [_round(point[0]), _round(point[1])],
    ];
  }

  List<Map<String, Object?>> _instructions(
    _Mode mode,
    List<_Piece> pieces,
    int startIndex,
    List<List<double>> coordinates,
    bool english,
    int legIndex,
    int legCount,
  ) {
    final t = english ? _english : _spanish;
    // Group pieces into runs on the same road; connectors join the road they lead to.
    final runs = <_Run>[];
    for (final piece in pieces) {
      final edge = piece.edge;
      final fraction = (piece.to - piece.from).abs();
      final cls = graph.edgeClass[edge];
      final roundabout = (graph.edgeFlags[edge] & RoadFlags.roundabout) != 0;
      final label = _roadLabel(edge);
      final approximate = (graph.edgeFlags[edge] & RoadFlags.approximate) != 0;
      final key = approximate
          ? 'approximate'
          : roundabout
          ? 'roundabout'
          : graph.edgeName[edge] >= 0
          ? 'n${graph.edgeName[edge]}'
          : graph.edgeRef[edge] >= 0
          ? 'r${graph.edgeRef[edge]}'
          : cls == RoadClass.connector
          ? ''
          : 'c$cls';
      final meters = graph.edgeLength[edge] * fraction;
      final seconds = _edgeSeconds(mode, edge, fraction);
      final last = runs.isEmpty ? null : runs.last;
      if (last != null && (key == '' || key == last.key)) {
        last.meters += meters;
        last.seconds += seconds;
        last.points.addAll(piece.points.skip(1));
        if (roundabout) {
          final node = piece.reverse ? graph.edgeU[edge] : graph.edgeV[edge];
          if (graph.degree(node) >= 3) last.exits += 1;
        }
        continue;
      }
      runs.add(
        _Run(
          key: key == '' ? 'c$cls' : key,
          label: label,
          cls: cls,
          roundabout: roundabout,
          meters: meters,
          seconds: seconds,
          points: [...piece.points],
          exits:
              roundabout && graph.degree(piece.reverse ? graph.edgeU[edge] : graph.edgeV[edge]) >= 3
              ? 1
              : 0,
        ),
      );
    }
    // Very short runs between two runs of the same road are digitising artefacts.
    for (var i = 1; i < runs.length - 1; i += 1) {
      if (runs[i].meters < 25 && runs[i - 1].key == runs[i + 1].key && !runs[i].roundabout) {
        runs[i - 1].meters += runs[i].meters + runs[i + 1].meters;
        runs[i - 1].seconds += runs[i].seconds + runs[i + 1].seconds;
        runs[i - 1].points
          ..addAll(runs[i].points.skip(1))
          ..addAll(runs[i + 1].points.skip(1));
        runs.removeRange(i, i + 2);
        i -= 1;
      }
    }
    final steps = <Map<String, Object?>>[];
    var index = startIndex;
    int locate(List<double> point) {
      for (var i = index; i < coordinates.length; i += 1) {
        if (coordinates[i][0] == point[0] && coordinates[i][1] == point[1]) return i;
      }
      return index;
    }

    for (var position = 0; position < runs.length; position += 1) {
      final run = runs[position];
      final begin = locate(run.points.first);
      final end = locate(run.points.last);
      index = begin;
      String maneuver;
      String instruction;
      if (position == 0) {
        maneuver = legIndex == 0 ? 'DEPART' : 'WAYPOINT';
        final heading = t.headings[_headingIndex(_bearing(run.points, start: true))];
        instruction = legIndex == 0
            ? t.depart(heading, run.label, run.cls)
            : t.continueFromStop(heading, run.label, run.cls);
      } else if (run.roundabout) {
        maneuver = 'ROUNDABOUT_ENTER';
        final next = position + 1 < runs.length ? runs[position + 1] : null;
        instruction = t.roundabout(math.max(1, run.exits), next?.label, next?.cls ?? run.cls);
      } else {
        final previous = runs[position - 1];
        if (previous.roundabout) {
          maneuver = 'ROUNDABOUT_EXIT';
          instruction = t.follow(run.label, run.cls);
        } else if (run.key == 'approximate') {
          maneuver = 'OTHER';
          instruction = t.approximate(run.meters);
        } else {
          final angle = _turnAngle(previous.points, run.points);
          maneuver = _turnType(angle);
          instruction = t.turn(maneuver, run.label, run.cls);
        }
      }
      steps.add({
        'instruction': instruction,
        'distanceMeters': jsRoundInt(run.meters),
        'durationSeconds': jsRoundInt(run.seconds),
        'maneuver': maneuver,
        'location': run.points.first,
        'streetNames': [if (_truthy(run.label)) run.label],
        'geometryIndex': [begin, math.max(begin, end)],
      });
    }
    final last = legIndex == legCount - 1;
    steps.add({
      'instruction': last ? t.arrive : t.stop(legIndex + 1),
      'distanceMeters': 0,
      'durationSeconds': 0,
      'maneuver': last ? 'ARRIVE' : 'WAYPOINT',
      'location': coordinates.last,
      'streetNames': const <String>[],
      'geometryIndex': [coordinates.length - 1, coordinates.length - 1],
    });
    return steps;
  }

  String? _roadLabel(int edge) {
    final name = graph.nameOf(edge);
    final ref = graph.refOf(edge);
    if ((graph.edgeFlags[edge] & RoadFlags.stateRoad) != 0) {
      if (_truthy(ref) && _truthy(name)) return '$ref ($name)';
      return ref ?? name;
    }
    if (_truthy(name) && _truthy(ref) && !name!.contains(ref!)) return '$name ($ref)';
    return name ?? ref;
  }
}

// ---------------------------------------------------------------- helpers

/// JavaScript truthiness of an optional string.
bool _truthy(String? value) => value != null && value.isNotEmpty;

/// `value || 1` of JavaScript for a number.
double _orOne(double value) => value == 0 || value.isNaN ? 1 : value;

double _round(double value) => jsRound(value * 1e6) / 1e6;

T? _find<T>(List<T> items, bool Function(T item) test) {
  for (final item in items) {
    if (test(item)) return item;
  }
  return null;
}

List<double> _bboxOf(List<List<double>> positions) {
  var minLng = double.infinity;
  var minLat = double.infinity;
  var maxLng = double.negativeInfinity;
  var maxLat = double.negativeInfinity;
  for (final position in positions) {
    minLng = math.min(minLng, position[0]);
    minLat = math.min(minLat, position[1]);
    maxLng = math.max(maxLng, position[0]);
    maxLat = math.max(maxLat, position[1]);
  }
  return [minLng, minLat, maxLng, maxLat];
}

/// Bearing (degrees from north) of the first or last ~25 m of a polyline.
double _bearing(List<List<double>> points, {required bool start}) {
  final ordered = start ? points : points.reversed.toList();
  final origin = ordered.first;
  var target = ordered.last;
  var travelled = 0.0;
  for (var i = 1; i < ordered.length; i += 1) {
    final kx = metersPerDegree * math.cos((ordered[i][1] * math.pi) / 180);
    travelled += jsHypot(
      (ordered[i][0] - ordered[i - 1][0]) * kx,
      (ordered[i][1] - ordered[i - 1][1]) * metersPerDegree,
    );
    target = ordered[i];
    if (travelled >= 25) break;
  }
  final kx = math.cos((origin[1] * math.pi) / 180);
  final angle = (math.atan2((target[0] - origin[0]) * kx, target[1] - origin[1]) * 180) / math.pi;
  return start ? (angle + 360).remainder(360) : (angle + 540).remainder(360);
}

double _turnAngle(List<List<double>> incoming, List<List<double>> outgoing) {
  final before = _bearing(incoming, start: false);
  final after = _bearing(outgoing, start: true);
  var angle = after - before;
  while (angle > 180) {
    angle -= 360;
  }
  while (angle <= -180) {
    angle += 360;
  }
  return angle;
}

String _turnType(double angle) {
  final size = angle.abs();
  if (size < 20) return 'CONTINUE';
  final right = angle > 0;
  if (size < 45) return right ? 'SLIGHT_RIGHT' : 'SLIGHT_LEFT';
  if (size < 135) return right ? 'TURN_RIGHT' : 'TURN_LEFT';
  if (size < 170) return right ? 'SHARP_RIGHT' : 'SHARP_LEFT';
  return 'UTURN';
}

int _headingIndex(double degrees) => jsRoundInt(degrees / 45) % 8;

String _kilometers(double meters, String decimal) => meters >= 1000
    ? '${(meters / 1000).toStringAsFixed(1).replaceFirst('.', decimal)} km'
    : '${jsRoundInt(meters)} m';

class _Phrases {
  const _Phrases({
    required this.headings,
    required this.unnamed,
    required this.ordinals,
    required this.ordinalSuffix,
    required this.departTemplate,
    required this.continueFromStopTemplate,
    required this.turns,
    required this.followTemplate,
    required this.roundaboutTemplate,
    required this.arrive,
    required this.stopTemplate,
    required this.approximateTemplate,
    required this.decimal,
  });

  final List<String> headings;
  final String Function(int cls) unnamed;
  final List<String> ordinals;
  final String ordinalSuffix;
  final String departTemplate;
  final String continueFromStopTemplate;
  final Map<String, String> turns;
  final String followTemplate;
  final String roundaboutTemplate;
  final String arrive;
  final String stopTemplate;
  final String approximateTemplate;
  final String decimal;

  String _road(String? label, int cls) => label ?? unnamed(cls);

  String depart(String heading, String? label, int cls) =>
      departTemplate.replaceFirst('{heading}', heading).replaceFirst('{road}', _road(label, cls));

  String continueFromStop(String heading, String? label, int cls) => continueFromStopTemplate
      .replaceFirst('{heading}', heading)
      .replaceFirst('{road}', _road(label, cls));

  String turn(String maneuver, String? label, int cls) =>
      (turns[maneuver] ?? turns['CONTINUE']!).replaceFirst('{road}', _road(label, cls));

  String follow(String? label, int cls) => followTemplate.replaceFirst('{road}', _road(label, cls));

  String roundabout(int exit, String? label, int cls) {
    final position = math.min(exit, 8) - 1;
    final ordinal = position >= 0 && position < ordinals.length
        ? ordinals[position]
        : '$exit$ordinalSuffix';
    return roundaboutTemplate
        .replaceFirst('{exit}', ordinal)
        .replaceFirst('{road}', _road(label, cls));
  }

  String stop(int index) => stopTemplate.replaceFirst('{index}', '$index');

  String approximate(double meters) =>
      approximateTemplate.replaceFirst('{length}', _kilometers(meters, decimal));
}

String _unnamedEs(int cls) => cls == RoadClass.service
    ? 'el pasaje'
    : cls == RoadClass.track
    ? 'el camino'
    : cls >= RoadClass.path && cls <= RoadClass.steps
    ? 'el paso peatonal'
    : cls <= RoadClass.primary
    ? 'la vía'
    : 'la calle';

String _unnamedEn(int cls) => cls == RoadClass.service
    ? 'the lane'
    : cls == RoadClass.track
    ? 'the track'
    : cls >= RoadClass.path && cls <= RoadClass.steps
    ? 'the footpath'
    : 'the road';

const _spanish = _Phrases(
  headings: ['norte', 'noreste', 'este', 'sureste', 'sur', 'suroeste', 'oeste', 'noroeste'],
  unnamed: _unnamedEs,
  ordinals: ['primera', 'segunda', 'tercera', 'cuarta', 'quinta', 'sexta', 'séptima', 'octava'],
  ordinalSuffix: '.ª',
  departTemplate: 'Dirígete al {heading} por {road}',
  continueFromStopTemplate: 'Desde la parada, dirígete al {heading} por {road}',
  turns: {
    'CONTINUE': 'Continúa por {road}',
    'SLIGHT_RIGHT': 'Gira levemente a la derecha hacia {road}',
    'SLIGHT_LEFT': 'Gira levemente a la izquierda hacia {road}',
    'TURN_RIGHT': 'Gira a la derecha en {road}',
    'TURN_LEFT': 'Gira a la izquierda en {road}',
    'SHARP_RIGHT': 'Gira fuertemente a la derecha en {road}',
    'SHARP_LEFT': 'Gira fuertemente a la izquierda en {road}',
    'UTURN': 'Da la vuelta en U por {road}',
  },
  followTemplate: 'Sal del redondel por {road}',
  roundaboutTemplate: 'En el redondel, toma la {exit} salida hacia {road}',
  arrive: 'Llegaste a tu destino',
  stopTemplate: 'Llegaste a la parada {index}',
  approximateTemplate:
      'Continúa por el acceso local (tramo aproximado de {length}, sin vía registrada)',
  decimal: ',',
);

const _english = _Phrases(
  headings: ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'],
  unnamed: _unnamedEn,
  ordinals: ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth'],
  ordinalSuffix: 'th',
  departTemplate: 'Head {heading} on {road}',
  continueFromStopTemplate: 'From the stop, head {heading} on {road}',
  turns: {
    'CONTINUE': 'Continue on {road}',
    'SLIGHT_RIGHT': 'Bear right onto {road}',
    'SLIGHT_LEFT': 'Bear left onto {road}',
    'TURN_RIGHT': 'Turn right onto {road}',
    'TURN_LEFT': 'Turn left onto {road}',
    'SHARP_RIGHT': 'Make a sharp right onto {road}',
    'SHARP_LEFT': 'Make a sharp left onto {road}',
    'UTURN': 'Make a U-turn on {road}',
  },
  followTemplate: 'Exit the roundabout onto {road}',
  roundaboutTemplate: 'At the roundabout, take the {exit} exit onto {road}',
  arrive: 'You have arrived at your destination',
  stopTemplate: 'You have arrived at stop {index}',
  approximateTemplate:
      'Continue on the local access road (approximate stretch of {length}, not mapped)',
  decimal: '.',
);

/// Binary min-heap of (key, node) over growable typed lists.
class _Heap {
  var _keys = Float64List(1024);
  var _values = Int32List(1024);
  var size = 0;

  /// Key of the entry returned by the last [pop].
  var poppedKey = 0.0;

  void clear() => size = 0;

  void push(double key, int value) {
    if (size == _keys.length) {
      _keys = Float64List(_keys.length * 2)..setRange(0, size, _keys);
      _values = Int32List(_values.length * 2)..setRange(0, size, _values);
    }
    var index = size++;
    while (index > 0) {
      final parent = (index - 1) >> 1;
      if (_keys[parent] <= key) break;
      _keys[index] = _keys[parent];
      _values[index] = _values[parent];
      index = parent;
    }
    _keys[index] = key;
    _values[index] = value;
  }

  /// Removes the entry with the smallest key and returns its value ([poppedKey] is its key).
  int pop() {
    poppedKey = _keys[0];
    final value = _values[0];
    final lastKey = _keys[--size];
    final lastValue = _values[size];
    var index = 0;
    while (true) {
      final left = index * 2 + 1;
      if (left >= size) break;
      final right = left + 1;
      final child = right < size && _keys[right] < _keys[left] ? right : left;
      if (_keys[child] >= lastKey) break;
      _keys[index] = _keys[child];
      _values[index] = _values[child];
      index = child;
    }
    _keys[index] = lastKey;
    _values[index] = lastValue;
    return value;
  }
}
