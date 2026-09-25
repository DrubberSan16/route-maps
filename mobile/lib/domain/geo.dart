import 'dart:math' as math;

import 'package:flutter/foundation.dart';

import 'entities/coordinate.dart';

/// Mean Earth radius (IUGG), the same value PostGIS uses for spheroid-less math.
const earthRadiusMeters = 6371008.8;

double _radians(double degrees) => degrees * math.pi / 180;

/// Great-circle distance between two points (haversine formula).
double distanceMeters(Coordinate a, Coordinate b) {
  final dLat = _radians(b.latitude - a.latitude);
  final dLng = _radians(b.longitude - a.longitude);
  final h =
      math.pow(math.sin(dLat / 2), 2) +
      math.cos(_radians(a.latitude)) *
          math.cos(_radians(b.latitude)) *
          math.pow(math.sin(dLng / 2), 2);
  return 2 * earthRadiusMeters * math.asin(math.min(1, math.sqrt(h)));
}

/// Length of a polyline in meters.
double lineLengthMeters(List<Coordinate> line) {
  var total = 0.0;
  for (var i = 1; i < line.length; i++) {
    total += distanceMeters(line[i - 1], line[i]);
  }
  return total;
}

/// Index of the vertex of [line] closest to [point] and its distance.
({int index, double meters}) nearestVertex(List<Coordinate> line, Coordinate point) {
  if (line.isEmpty) throw ArgumentError.value(line, 'line', 'must not be empty');
  var best = 0;
  var bestDistance = double.infinity;
  for (var i = 0; i < line.length; i++) {
    final d = distanceMeters(line[i], point);
    if (d < bestDistance) {
      bestDistance = d;
      best = i;
    }
  }
  return (index: best, meters: bestDistance);
}

/// A position along a polyline: [vertex] plus the [fraction] (0 ≤ f < 1) of
/// the segment that starts at that vertex. The last vertex has fraction 0.
@immutable
class LinePosition implements Comparable<LinePosition> {
  const LinePosition(this.vertex, [this.fraction = 0]);

  final int vertex;
  final double fraction;

  /// Continuous coordinate along the line (`vertex + fraction`).
  double get value => vertex + fraction;

  @override
  int compareTo(LinePosition other) => value.compareTo(other.value);

  @override
  bool operator ==(Object other) =>
      other is LinePosition && other.vertex == vertex && other.fraction == fraction;

  @override
  int get hashCode => Object.hash(vertex, fraction);

  @override
  String toString() => 'LinePosition($vertex + $fraction)';
}

/// The point of a line closest to a given point.
typedef LineMatch = ({LinePosition position, Coordinate point, double meters});

/// Closest point of [line] to [point]. With [after], only positions at or
/// after it are considered (to follow the direction of travel).
///
/// Uses a local equirectangular projection around [point], accurate for the
/// distances involved in matching a position to a route (meters to a few
/// kilometers); lines crossing the antimeridian are not supported.
LineMatch locateOnLine(List<Coordinate> line, Coordinate point, {LinePosition? after}) {
  if (line.isEmpty) throw ArgumentError.value(line, 'line', 'must not be empty');
  final from = after ?? const LinePosition(0);
  if (line.length == 1 || from.vertex >= line.length - 1) {
    final last = pointAt(line, from);
    return (position: from, point: last, meters: distanceMeters(last, point));
  }
  final cosLat = math.cos(_radians(point.latitude));
  double x(Coordinate c) => _radians(c.longitude - point.longitude) * cosLat;
  double y(Coordinate c) => _radians(c.latitude - point.latitude);

  var bestSegment = from.vertex;
  var bestFraction = from.fraction;
  var bestSquared = double.infinity;
  for (var i = from.vertex; i < line.length - 1; i++) {
    final ax = x(line[i]), ay = y(line[i]);
    final dx = x(line[i + 1]) - ax, dy = y(line[i + 1]) - ay;
    final lengthSquared = dx * dx + dy * dy;
    final minFraction = i == from.vertex ? from.fraction : 0.0;
    var t = lengthSquared == 0 ? 0.0 : -(ax * dx + ay * dy) / lengthSquared;
    t = t.clamp(minFraction, 1.0);
    final cx = ax + t * dx, cy = ay + t * dy;
    final squared = cx * cx + cy * cy;
    if (squared < bestSquared) {
      bestSquared = squared;
      bestSegment = i;
      bestFraction = t;
    }
  }
  final position = bestFraction >= 1
      ? LinePosition(bestSegment + 1)
      : LinePosition(bestSegment, bestFraction);
  final closest = pointAt(line, position);
  return (position: position, point: closest, meters: distanceMeters(closest, point));
}

/// Coordinate at [position] (linear interpolation inside the segment).
Coordinate pointAt(List<Coordinate> line, LinePosition position) {
  if (position.fraction == 0 || position.vertex >= line.length - 1) {
    return line[math.min(position.vertex, line.length - 1)];
  }
  final a = line[position.vertex], b = line[position.vertex + 1];
  final f = position.fraction;
  return Coordinate(
    a.latitude + (b.latitude - a.latitude) * f,
    a.longitude + (b.longitude - a.longitude) * f,
  );
}

/// Part of [line] between [from] and [to] (`from <= to`), both included.
List<Coordinate> sliceLine(List<Coordinate> line, LinePosition from, LinePosition to) {
  if (to.compareTo(from) < 0) {
    throw ArgumentError.value(to, 'to', 'must not be before $from');
  }
  final lastInner = to.fraction == 0 ? to.vertex - 1 : to.vertex;
  return [
    pointAt(line, from),
    for (var k = from.vertex + 1; k <= lastInner; k++) line[k],
    if (to != from) pointAt(line, to),
  ];
}
