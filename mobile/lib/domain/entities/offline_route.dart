import 'package:flutter/foundation.dart';

import 'coordinate.dart';
import 'route.dart';
import 'routing_profile.dart';

/// A route stored on the device (Drift) so it can be drawn and followed
/// without connection. The same id is used on the server once synchronized.
@immutable
class OfflineRoute {
  const OfflineRoute({
    required this.routeId,
    required this.name,
    required this.profile,
    required this.origin,
    required this.destination,
    required this.distanceMeters,
    required this.durationSeconds,
    required this.geometry,
    required this.steps,
    required this.createdAt,
    required this.updatedAt,
    this.regionId,
    this.provider,
  });

  /// Parses a saved route as returned by `GET /api/v1/sync/pull`.
  factory OfflineRoute.fromApi(Map<String, Object?> json) {
    final geometry = json['geometry']! as Map<String, Object?>;
    return OfflineRoute(
      routeId: json['id']! as String,
      name: json['name']! as String,
      profile: RoutingProfile.fromApi(json['profile']! as String),
      origin: Coordinate.fromJson(json['origin']! as Map<String, Object?>),
      destination: Coordinate.fromJson(json['destination']! as Map<String, Object?>),
      distanceMeters: (json['distanceMeters']! as num).toDouble(),
      durationSeconds: (json['durationSeconds']! as num).toDouble(),
      geometry: [
        for (final position in geometry['coordinates']! as List<Object?>)
          Coordinate.fromLngLat(position! as List<Object?>),
      ],
      steps: [
        for (final step in (json['steps'] as List<Object?>?) ?? const [])
          RouteStep.fromJson(step! as Map<String, Object?>),
      ],
      regionId: json['regionCode'] as String?,
      provider: json['provider'] as String?,
      createdAt: DateTime.parse(json['createdAt']! as String),
      updatedAt: DateTime.parse(json['updatedAt']! as String),
    );
  }

  final String routeId;
  final String name;
  final RoutingProfile profile;
  final Coordinate origin;
  final Coordinate destination;
  final double distanceMeters;
  final double durationSeconds;
  final List<Coordinate> geometry;
  final List<RouteStep> steps;

  /// Region the route belongs to, when known.
  final String? regionId;
  final String? provider;
  final DateTime createdAt;
  final DateTime updatedAt;

  RouteOption toRouteOption() => RouteOption(
    routeId: routeId,
    type: RouteType.primary,
    distanceMeters: distanceMeters,
    durationSeconds: durationSeconds,
    geometry: geometry,
    steps: steps,
    savedRouteId: routeId,
    savedRouteName: name,
  );

  RouteResult toRouteResult() => RouteResult(
    profile: profile,
    provider: provider ?? 'saved',
    source: RouteSource.savedRoute,
    routes: [toRouteOption()],
    origin: origin,
    destination: destination,
  );

  /// Payload of the `route:UPSERT` sync operation (same shape as `POST /api/v1/routes`).
  Map<String, Object?> toSyncPayload() => {
    'id': routeId,
    'name': name,
    'profile': profile.apiValue,
    'origin': origin.toJson(),
    'destination': destination.toJson(),
    'distanceMeters': distanceMeters,
    'durationSeconds': durationSeconds,
    'geometry': {
      'type': 'LineString',
      'coordinates': [for (final point in geometry) point.toLngLat()],
    },
    'steps': [for (final step in steps) step.toJson()],
    if (regionId != null) 'regionCode': regionId,
    if (provider != null) 'provider': provider,
  };
}
