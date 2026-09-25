import 'package:flutter/foundation.dart';

/// A WGS84 position. GeoJSON and the API geometries use `[longitude, latitude]`
/// order; this class always names both values explicitly.
@immutable
class Coordinate {
  const Coordinate(this.latitude, this.longitude);

  /// Parses `{latitude, longitude}` objects as used by the API.
  factory Coordinate.fromJson(Map<String, Object?> json) =>
      Coordinate((json['latitude']! as num).toDouble(), (json['longitude']! as num).toDouble());

  /// Parses a GeoJSON position `[lng, lat]`.
  factory Coordinate.fromLngLat(List<Object?> position) =>
      Coordinate((position[1]! as num).toDouble(), (position[0]! as num).toDouble());

  final double latitude;
  final double longitude;

  bool get isValid =>
      latitude.isFinite &&
      longitude.isFinite &&
      latitude >= -90 &&
      latitude <= 90 &&
      longitude >= -180 &&
      longitude <= 180;

  Map<String, Object?> toJson() => {'latitude': latitude, 'longitude': longitude};

  List<double> toLngLat() => [longitude, latitude];

  @override
  bool operator ==(Object other) =>
      other is Coordinate && other.latitude == latitude && other.longitude == longitude;

  @override
  int get hashCode => Object.hash(latitude, longitude);

  @override
  String toString() => '${latitude.toStringAsFixed(5)}, ${longitude.toStringAsFixed(5)}';
}

/// Geographic bounding box in degrees (`[west, south, east, north]` in the API).
@immutable
class BoundingBox {
  const BoundingBox({
    required this.west,
    required this.south,
    required this.east,
    required this.north,
  });

  factory BoundingBox.fromList(List<Object?> values) {
    if (values.length != 4) {
      throw FormatException('A bounding box needs 4 values, got ${values.length}');
    }
    final numbers = [for (final value in values) (value! as num).toDouble()];
    return BoundingBox(west: numbers[0], south: numbers[1], east: numbers[2], north: numbers[3]);
  }

  /// Smallest box containing every point. [points] must not be empty.
  factory BoundingBox.around(Iterable<Coordinate> points) {
    final iterator = points.iterator;
    if (!iterator.moveNext()) {
      throw ArgumentError.value(points, 'points', 'must not be empty');
    }
    var west = iterator.current.longitude, east = west;
    var south = iterator.current.latitude, north = south;
    while (iterator.moveNext()) {
      final point = iterator.current;
      if (point.longitude < west) west = point.longitude;
      if (point.longitude > east) east = point.longitude;
      if (point.latitude < south) south = point.latitude;
      if (point.latitude > north) north = point.latitude;
    }
    return BoundingBox(west: west, south: south, east: east, north: north);
  }

  final double west;
  final double south;
  final double east;
  final double north;

  bool contains(Coordinate point) =>
      point.longitude >= west &&
      point.longitude <= east &&
      point.latitude >= south &&
      point.latitude <= north;

  /// Area in square degrees; only used to compare boxes with each other.
  double get area => (east - west) * (north - south);

  Coordinate get center => Coordinate((south + north) / 2, (west + east) / 2);

  List<double> toList() => [west, south, east, north];

  @override
  bool operator ==(Object other) =>
      other is BoundingBox &&
      other.west == west &&
      other.south == south &&
      other.east == east &&
      other.north == north;

  @override
  int get hashCode => Object.hash(west, south, east, north);

  @override
  String toString() => 'BoundingBox($west, $south, $east, $north)';
}
