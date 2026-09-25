import 'package:flutter/foundation.dart';

import 'coordinate.dart';

/// A GPS fix. Values the device could not measure are null.
@immutable
class Position {
  const Position({
    required this.coordinate,
    required this.timestamp,
    this.accuracy,
    this.altitude,
    this.speed,
    this.heading,
  });

  final Coordinate coordinate;

  /// Time of the fix, in UTC.
  final DateTime timestamp;

  /// Horizontal accuracy radius in meters.
  final double? accuracy;

  /// Altitude in meters.
  final double? altitude;

  /// Speed in m/s.
  final double? speed;

  /// Direction of travel in degrees (0-360, clockwise from north).
  final double? heading;

  double get latitude => coordinate.latitude;
  double get longitude => coordinate.longitude;

  @override
  String toString() => 'Position($coordinate ±${accuracy?.round()} m at $timestamp)';
}
