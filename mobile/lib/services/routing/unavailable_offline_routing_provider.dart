import '../../core/errors/app_exception.dart';
import '../../domain/entities/coordinate.dart';
import '../../domain/entities/route.dart';
import '../../domain/entities/routing_profile.dart';
import '../../domain/services/offline_routing_provider.dart';

/// The provider used while no on-device routing engine is bundled with the
/// app: it reports that it cannot route, so the app explains that a new route
/// needs a connection instead of inventing one. See docs/offline-architecture.md.
class UnavailableOfflineRoutingProvider implements OfflineRoutingProvider {
  const UnavailableOfflineRoutingProvider();

  @override
  String get name => 'none';

  @override
  Future<bool> canRoute({
    required Coordinate origin,
    required Coordinate destination,
    required RoutingProfile profile,
  }) async => false;

  @override
  Future<RouteResult> calculateRoute({
    required Coordinate origin,
    required Coordinate destination,
    required RoutingProfile profile,
  }) async => throw AppException.of(ErrorCodes.offlineRouteUnavailable);
}
