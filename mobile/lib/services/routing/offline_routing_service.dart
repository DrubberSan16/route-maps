import 'dart:math' as math;

import '../../core/errors/app_exception.dart';
import '../../core/utils/formatters.dart';
import '../../domain/entities/coordinate.dart';
import '../../domain/entities/offline_route.dart';
import '../../domain/entities/route.dart';
import '../../domain/entities/routing_profile.dart';
import '../../domain/geo.dart';
import '../../domain/repositories/saved_route_repository.dart';
import '../../domain/services/offline_routing_provider.dart';
import '../../domain/services/routing_service.dart';
import 'unavailable_offline_routing_provider.dart';

/// Routing without connection.
///
/// Mode 1 (implemented): reuse the routes stored on the device. A stored route
/// of the same profile answers the request when the origin lies on it and the
/// destination lies on it further ahead (both within a tolerance); the part
/// between them is returned with its geometry, instructions, distance and
/// time. Routes are only followed in their own direction: going backwards
/// could break one-way streets and turn restrictions.
///
/// Mode 2: a new route calculated on the device by [OfflineRoutingProvider].
/// Without an installed engine the request fails with
/// [ErrorCodes.offlineRouteUnavailable]; no straight line is made up.
class OfflineRoutingService implements RoutingService {
  OfflineRoutingService({
    required this._savedRoutes,
    this._provider = const UnavailableOfflineRoutingProvider(),
    this.originToleranceMeters = 150,
    this.destinationToleranceMeters = 150,
    this.maxAlternatives = 2,
  });

  final SavedRouteRepository _savedRoutes;
  final OfflineRoutingProvider _provider;

  /// Maximum distance between the origin and the stored route.
  final double originToleranceMeters;

  /// Maximum distance between the destination and the stored route.
  final double destinationToleranceMeters;

  /// Other matching stored routes offered as alternatives.
  final int maxAlternatives;

  /// Closer than this to the end of the stored route counts as arriving.
  static const _arrivalRadiusMeters = 30.0;

  @override
  Future<RouteResult> calculateRoute({
    required Coordinate origin,
    required Coordinate destination,
    required RoutingProfile profile,
    bool alternatives = true,
  }) async {
    final stored = await matchStoredRoutes(
      origin: origin,
      destination: destination,
      profile: profile,
    );
    if (stored.isNotEmpty) {
      final options = [
        stored.first.option,
        if (alternatives)
          for (final match in stored.skip(1).take(maxAlternatives))
            match.option.withType(RouteType.alternative),
      ];
      return RouteResult(
        profile: profile,
        provider: stored.first.route.provider ?? 'saved',
        source: RouteSource.savedRoute,
        routes: options,
        origin: origin,
        destination: destination,
      );
    }
    if (await _provider.canRoute(origin: origin, destination: destination, profile: profile)) {
      return _provider.calculateRoute(origin: origin, destination: destination, profile: profile);
    }
    throw AppException.of(ErrorCodes.offlineRouteUnavailable);
  }

  /// Stored routes that cover the trip, best first (smallest detour to reach
  /// and leave the route, then shortest time).
  Future<List<StoredRouteMatch>> matchStoredRoutes({
    required Coordinate origin,
    required Coordinate destination,
    required RoutingProfile profile,
  }) async {
    final matches = <StoredRouteMatch>[];
    for (final route in await _savedRoutes.byProfile(profile)) {
      final match = _match(route, origin, destination);
      if (match != null) matches.add(match);
    }
    matches.sort((a, b) {
      final byOffset = a.offsetMeters.compareTo(b.offsetMeters);
      return byOffset != 0
          ? byOffset
          : a.option.durationSeconds.compareTo(b.option.durationSeconds);
    });
    return matches;
  }

  StoredRouteMatch? _match(OfflineRoute route, Coordinate origin, Coordinate destination) {
    final line = route.geometry;
    if (line.length < 2) return null;
    // Cheap rejection before walking the geometry.
    final bbox = BoundingBox.around(line);
    if (!_nearBox(bbox, origin, originToleranceMeters) ||
        !_nearBox(bbox, destination, destinationToleranceMeters)) {
      return null;
    }
    final start = locateOnLine(line, origin);
    if (start.meters > originToleranceMeters) return null;
    final end = locateOnLine(line, destination, after: start.position);
    if (end.meters > destinationToleranceMeters) return null;
    if (end.position.compareTo(start.position) <= 0) return null;

    final geometry = sliceLine(line, start.position, end.position);
    if (lineLengthMeters(geometry) < 1) return null;
    final whole = start.position.value == 0 && end.position.value == line.length - 1;
    final option = whole
        ? route.toRouteOption()
        : _trim(route, start.position, end.position, geometry, end.meters);
    return StoredRouteMatch(
      route: route,
      option: option,
      originOffsetMeters: start.meters,
      destinationOffsetMeters: end.meters,
    );
  }

  /// The part of [route] between [from] and [to], with its instructions.
  RouteOption _trim(
    OfflineRoute route,
    LinePosition from,
    LinePosition to,
    List<Coordinate> geometry,
    double destinationOffsetMeters,
  ) {
    final line = route.geometry;
    final lastIndex = geometry.length - 1;
    int reindex(int vertex) {
      if (vertex <= from.value) return 0;
      if (vertex >= to.value) return lastIndex;
      return vertex - from.vertex;
    }

    final steps = <RouteStep>[];
    for (final step in route.steps) {
      if (step.maneuver == Maneuvers.arrive) continue;
      final start = math.max(step.geometryStart.toDouble(), from.value);
      final end = math.min(step.geometryEnd.toDouble(), to.value);
      if (start >= end) continue;

      final passedManeuver = step.geometryStart < from.value;
      final cutShort = step.geometryEnd > to.value;
      if (!passedManeuver && !cutShort) {
        steps.add(_reindexed(step, reindex(step.geometryStart), reindex(step.geometryEnd)));
        continue;
      }
      final stepFrom = passedManeuver ? from : LinePosition(step.geometryStart);
      final stepTo = cutShort ? to : LinePosition(step.geometryEnd);
      final fullLength = lineLengthMeters(line.sublist(step.geometryStart, step.geometryEnd + 1));
      final partLength = lineLengthMeters(sliceLine(line, stepFrom, stepTo));
      final ratio = fullLength > 0 ? math.min(1.0, partLength / fullLength) : 0.0;
      steps.add(
        RouteStep(
          // The maneuver of this step is behind the origin: continue instead.
          instruction: passedManeuver ? _continueInstruction(step) : step.instruction,
          distanceMeters: step.distanceMeters * ratio,
          durationSeconds: step.durationSeconds * ratio,
          maneuver: passedManeuver ? Maneuvers.depart : step.maneuver,
          location: passedManeuver ? geometry.first : step.location,
          streetNames: step.streetNames,
          geometryStart: passedManeuver ? 0 : reindex(step.geometryStart),
          geometryEnd: cutShort ? lastIndex : reindex(step.geometryEnd),
        ),
      );
    }

    final originalArrival = route.steps.isNotEmpty && route.steps.last.maneuver == Maneuvers.arrive
        ? route.steps.last
        : null;
    final reachesEnd = to.value == line.length - 1;
    steps.add(
      reachesEnd && originalArrival != null
          ? _reindexed(originalArrival, lastIndex, lastIndex)
          : RouteStep(
              instruction: destinationOffsetMeters <= _arrivalRadiusMeters
                  ? 'Ha llegado a su destino.'
                  : 'Fin de la ruta guardada. Su destino está a '
                        '${formatDistance(destinationOffsetMeters)}.',
              distanceMeters: 0,
              durationSeconds: 0,
              maneuver: Maneuvers.arrive,
              location: geometry.last,
              geometryStart: lastIndex,
              geometryEnd: lastIndex,
            ),
    );

    final hasInstructions = steps.length > 1;
    final ratio = lineLengthMeters(geometry) / math.max(1, lineLengthMeters(line));
    return RouteOption(
      routeId: route.routeId,
      type: RouteType.primary,
      distanceMeters: hasInstructions
          ? steps.fold(0, (sum, step) => sum + step.distanceMeters)
          : route.distanceMeters * ratio,
      durationSeconds: hasInstructions
          ? steps.fold(0, (sum, step) => sum + step.durationSeconds)
          : route.durationSeconds * ratio,
      geometry: geometry,
      steps: steps,
      savedRouteId: route.routeId,
      savedRouteName: route.name,
    );
  }

  static RouteStep _reindexed(RouteStep step, int start, int end) => RouteStep(
    instruction: step.instruction,
    distanceMeters: step.distanceMeters,
    durationSeconds: step.durationSeconds,
    maneuver: step.maneuver,
    location: step.location,
    streetNames: step.streetNames,
    geometryStart: start,
    geometryEnd: end,
  );

  static String _continueInstruction(RouteStep step) => step.streetNames.isEmpty
      ? 'Continúe por la ruta guardada.'
      : 'Continúe por ${step.streetNames.first}.';

  /// Whether [point] is within [meters] of [box] (approximate, degrees).
  static bool _nearBox(BoundingBox box, Coordinate point, double meters) {
    final latMargin = meters / 111320;
    final cosLat = math.cos(point.latitude * math.pi / 180).abs();
    final lngMargin = cosLat < 1e-6 ? 180.0 : meters / (111320 * cosLat);
    return point.latitude >= box.south - latMargin &&
        point.latitude <= box.north + latMargin &&
        point.longitude >= box.west - lngMargin &&
        point.longitude <= box.east + lngMargin;
  }
}

/// A stored route that covers a trip, and the part of it to follow.
class StoredRouteMatch {
  const StoredRouteMatch({
    required this.route,
    required this.option,
    required this.originOffsetMeters,
    required this.destinationOffsetMeters,
  });

  final OfflineRoute route;
  final RouteOption option;

  /// Distance from the origin to the route.
  final double originOffsetMeters;

  /// Distance from the end of the route to the destination.
  final double destinationOffsetMeters;

  double get offsetMeters => originOffsetMeters + destinationOffsetMeters;
}
