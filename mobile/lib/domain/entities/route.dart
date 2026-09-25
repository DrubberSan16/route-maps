import 'package:flutter/foundation.dart';

import 'coordinate.dart';
import 'routing_profile.dart';

/// Maneuver kinds normalized by the backend (independent of the engine).
abstract final class Maneuvers {
  static const depart = 'DEPART';
  static const arrive = 'ARRIVE';
  static const waypoint = 'WAYPOINT';
  static const turnLeft = 'TURN_LEFT';
  static const turnRight = 'TURN_RIGHT';
  static const slightLeft = 'SLIGHT_LEFT';
  static const slightRight = 'SLIGHT_RIGHT';
  static const sharpLeft = 'SHARP_LEFT';
  static const sharpRight = 'SHARP_RIGHT';
  static const uturn = 'UTURN';
  static const continueStraight = 'CONTINUE';
  static const roundaboutEnter = 'ROUNDABOUT_ENTER';
  static const roundaboutExit = 'ROUNDABOUT_EXIT';
  static const merge = 'MERGE';
  static const ramp = 'RAMP';
  static const exit = 'EXIT';
  static const ferry = 'FERRY';
  static const other = 'OTHER';
}

/// One turn-by-turn instruction.
@immutable
class RouteStep {
  const RouteStep({
    required this.instruction,
    required this.distanceMeters,
    required this.durationSeconds,
    required this.maneuver,
    required this.location,
    required this.geometryStart,
    required this.geometryEnd,
    this.streetNames = const [],
  });

  factory RouteStep.fromJson(Map<String, Object?> json) {
    final range = (json['geometryIndex'] as List<Object?>?) ?? const [0, 0];
    return RouteStep(
      instruction: json['instruction']! as String,
      distanceMeters: (json['distanceMeters']! as num).toDouble(),
      durationSeconds: (json['durationSeconds']! as num).toDouble(),
      maneuver: (json['maneuver'] as String?) ?? Maneuvers.other,
      location: Coordinate.fromLngLat(json['location']! as List<Object?>),
      streetNames: [
        for (final name in (json['streetNames'] as List<Object?>?) ?? const []) name! as String,
      ],
      geometryStart: (range[0]! as num).toInt(),
      geometryEnd: (range[1]! as num).toInt(),
    );
  }

  final String instruction;
  final double distanceMeters;
  final double durationSeconds;
  final String maneuver;
  final Coordinate location;
  final List<String> streetNames;

  /// Vertex range of the route geometry covered by this step.
  final int geometryStart;
  final int geometryEnd;

  /// Same shape as the API, so saved routes round-trip through the backend.
  Map<String, Object?> toJson() => {
    'instruction': instruction,
    'distanceMeters': distanceMeters,
    'durationSeconds': durationSeconds,
    'maneuver': maneuver,
    'location': location.toLngLat(),
    'streetNames': streetNames,
    'geometryIndex': [geometryStart, geometryEnd],
  };
}

enum RouteType { primary, alternative }

/// One of the routes returned for a request (the primary one or an alternative).
@immutable
class RouteOption {
  const RouteOption({
    required this.routeId,
    required this.type,
    required this.distanceMeters,
    required this.durationSeconds,
    required this.geometry,
    required this.steps,
    this.hasTolls = false,
    this.hasFerry = false,
    this.savedRouteId,
    this.savedRouteName,
  });

  factory RouteOption.fromJson(Map<String, Object?> json) {
    final geometry = json['geometry']! as Map<String, Object?>;
    if (geometry['type'] != 'LineString') {
      throw FormatException('Route geometry must be a LineString, got ${geometry['type']}');
    }
    return RouteOption(
      routeId: json['routeId']! as String,
      type: json['type'] == 'ALTERNATIVE' ? RouteType.alternative : RouteType.primary,
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
      hasTolls: json['hasTolls'] == true,
      hasFerry: json['hasFerry'] == true,
    );
  }

  final String routeId;
  final RouteType type;
  final double distanceMeters;
  final double durationSeconds;
  final List<Coordinate> geometry;
  final List<RouteStep> steps;
  final bool hasTolls;
  final bool hasFerry;

  /// Set when the option comes from a route stored on the device.
  final String? savedRouteId;
  final String? savedRouteName;

  BoundingBox get bbox => BoundingBox.around(geometry);

  RouteOption withType(RouteType type) => RouteOption(
    routeId: routeId,
    type: type,
    distanceMeters: distanceMeters,
    durationSeconds: durationSeconds,
    geometry: geometry,
    steps: steps,
    hasTolls: hasTolls,
    hasFerry: hasFerry,
    savedRouteId: savedRouteId,
    savedRouteName: savedRouteName,
  );

  Map<String, Object?> geometryJson() => {
    'type': 'LineString',
    'coordinates': [for (final point in geometry) point.toLngLat()],
  };
}

/// Where a [RouteResult] came from. The UI tells the user which one applies.
enum RouteSource {
  /// Calculated by the routing engine behind our API.
  server,

  /// A route stored on the device (Mode 1 offline routing).
  savedRoute,

  /// Calculated by an on-device engine (Mode 2 offline routing).
  onDevice,
}

/// Result of a routing request: the primary route first, then alternatives.
@immutable
class RouteResult {
  RouteResult({
    required this.profile,
    required this.provider,
    required this.source,
    required List<RouteOption> routes,
    required this.origin,
    required this.destination,
  }) : routes = List.unmodifiable(routes) {
    if (routes.isEmpty) throw ArgumentError.value(routes, 'routes', 'must not be empty');
  }

  /// Parses the `data` of `POST /api/v1/routes/calculate`.
  factory RouteResult.fromApi(
    Map<String, Object?> json, {
    required Coordinate origin,
    required Coordinate destination,
  }) {
    final routes = [
      for (final route in (json['routes'] as List<Object?>?) ?? [json])
        RouteOption.fromJson(route! as Map<String, Object?>),
    ];
    return RouteResult(
      profile: RoutingProfile.fromApi(json['profile']! as String),
      provider: (json['provider'] as String?) ?? 'unknown',
      source: RouteSource.server,
      routes: routes,
      origin: origin,
      destination: destination,
    );
  }

  final RoutingProfile profile;

  /// Engine that produced the route (`valhalla`, `osrm`...).
  final String provider;
  final RouteSource source;
  final List<RouteOption> routes;
  final Coordinate origin;
  final Coordinate destination;

  RouteOption get primary => routes.first;
  double get distanceMeters => primary.distanceMeters;
  double get durationSeconds => primary.durationSeconds;
  List<Coordinate> get geometry => primary.geometry;
  List<RouteStep> get steps => primary.steps;
}
