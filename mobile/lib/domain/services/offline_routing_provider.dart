import '../entities/coordinate.dart';
import '../entities/route.dart';
import '../entities/routing_profile.dart';

/// On-device routing engine (Mode 2: a new route with no connection).
///
/// Map tiles (PMTiles) only draw the map; routing needs the road graph of the
/// region and an engine running on the device. See docs/offline-architecture.md
/// for the plan based on Valhalla's mobile build and the per-region routing
/// package the API already serves.
abstract class OfflineRoutingProvider {
  /// Engine name shown to the user.
  String get name;

  /// Whether the engine and the graph data for this trip are installed.
  Future<bool> canRoute({
    required Coordinate origin,
    required Coordinate destination,
    required RoutingProfile profile,
  });

  Future<RouteResult> calculateRoute({
    required Coordinate origin,
    required Coordinate destination,
    required RoutingProfile profile,
  });
}
