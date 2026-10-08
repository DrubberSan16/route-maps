import '../../core/errors/app_exception.dart';
import '../../domain/entities/coordinate.dart';
import '../../domain/entities/route.dart';
import '../../domain/entities/routing_profile.dart';
import '../../domain/services/offline_routing_provider.dart';

/// A provider without an on-device engine: it reports that it cannot route, so
/// the app explains that a new route needs a connection or a downloaded region
/// instead of inventing one.
class UnavailableOfflineRoutingProvider implements OfflineRoutingProvider {
  const UnavailableOfflineRoutingProvider();

  @override
  String get name => 'none';

  @override
  Future<bool> canRoute({
    required Coordinate origin,
    required Coordinate destination,
    required RoutingProfile profile,
    List<Coordinate> waypoints = const [],
  }) async => false;

  @override
  Future<RouteResult> calculateRoute({
    required Coordinate origin,
    required Coordinate destination,
    required RoutingProfile profile,
    List<Coordinate> waypoints = const [],
    bool alternatives = true,
  }) async => throw AppException.of(ErrorCodes.offlineRouteUnavailable);
}
