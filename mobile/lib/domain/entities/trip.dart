import 'package:flutter/foundation.dart';

import 'coordinate.dart';
import 'routing_profile.dart';
import 'sync.dart';

enum TripStatus {
  active('ACTIVE'),
  completed('COMPLETED'),
  cancelled('CANCELLED');

  const TripStatus(this.value);

  final String value;

  static TripStatus fromValue(String value) => values.firstWhere((status) => status.value == value);
}

/// A recorded journey (the GPS track is stored as [TrackingPoint]s).
@immutable
class Trip {
  const Trip({
    required this.id,
    required this.profile,
    required this.status,
    required this.startedAt,
    this.name,
    this.routeId,
    this.endedAt,
    this.distanceMeters = 0,
    this.pointCount = 0,
  });

  final String id;
  final String? name;
  final RoutingProfile profile;

  /// Saved route being followed, if any.
  final String? routeId;
  final TripStatus status;
  final DateTime startedAt;
  final DateTime? endedAt;

  /// Distance travelled, computed on the device from the recorded points.
  final double distanceMeters;
  final int pointCount;
}

/// One GPS fix of a trip, stored locally before it is synchronized.
@immutable
class TrackingPoint {
  const TrackingPoint({
    required this.tripId,
    required this.coordinate,
    required this.recordedAt,
    this.accuracy,
    this.speed,
    this.heading,
    this.altitude,
  });

  final String tripId;
  final Coordinate coordinate;
  final DateTime recordedAt;
  final double? accuracy;
  final double? speed;
  final double? heading;
  final double? altitude;

  /// Payload item of `tracking_point:CREATE` (the fields of `POST /api/v1/tracking/location`).
  /// Values outside the ranges the API accepts are left out instead of making
  /// the whole batch fail (iOS reports -1 for unknown speed or heading).
  Map<String, Object?> toPayload() => {
    'tripId': tripId,
    'latitude': coordinate.latitude,
    'longitude': coordinate.longitude,
    if (_inRange(accuracy, 0, 100000)) 'accuracy': accuracy,
    if (_inRange(speed, 0, 1000)) 'speed': speed,
    if (_inRange(heading, 0, 360)) 'heading': heading,
    if (_inRange(altitude, -1000, 20000)) 'altitude': altitude,
    'timestamp': isoUtc(recordedAt),
  };

  static bool _inRange(double? value, double min, double max) =>
      value != null && value.isFinite && value >= min && value <= max;
}
