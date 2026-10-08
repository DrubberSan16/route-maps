import '../entities/coordinate.dart';
import '../entities/route.dart';
import '../entities/routing_profile.dart';

/// On-device routing engine (Mode 2: a new route with no connection).
///
/// Map tiles (PMTiles) only draw the map; routing needs the road network of
/// the region and an engine running on the device: the offline pack of each
/// downloaded region and the port of the platform's native engine (see
/// docs/offline-architecture.md).
abstract class OfflineRoutingProvider {
  /// Engine name, recorded as the provider of its routes.
  String get name;

  /// Whether the engine and road data to try this trip are installed (whether
  /// they cover the trip is known when calculating it).
  Future<bool> canRoute({
    required Coordinate origin,
    required Coordinate destination,
    required RoutingProfile profile,
    List<Coordinate> waypoints = const [],
  });

  /// [waypoints] are intermediate stops visited in order; routes with stops
  /// come without alternatives.
  Future<RouteResult> calculateRoute({
    required Coordinate origin,
    required Coordinate destination,
    required RoutingProfile profile,
    List<Coordinate> waypoints = const [],
    bool alternatives = true,
  });
}
