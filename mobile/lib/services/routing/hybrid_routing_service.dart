import '../../core/errors/app_exception.dart';
import '../../domain/entities/coordinate.dart';
import '../../domain/entities/route.dart';
import '../../domain/entities/routing_profile.dart';
import '../../domain/services/connectivity_service.dart';
import '../../domain/services/routing_service.dart';

/// Chooses between the server and the device:
///
/// * online: the server calculates the route (with alternatives);
/// * offline, or the request fails for network reasons or because the
///   engine is down: the offline service answers (stored routes first, then
///   an on-device engine when one is installed).
class HybridRoutingService implements RoutingService {
  HybridRoutingService({
    required this._online,
    required this._offline,
    required this._connectivity,
  });

  final RoutingService _online;
  final RoutingService _offline;
  final ConnectivityService _connectivity;

  @override
  Future<RouteResult> calculateRoute({
    required Coordinate origin,
    required Coordinate destination,
    required RoutingProfile profile,
    bool alternatives = true,
  }) async {
    if (_connectivity.status == ConnectivityStatus.offline) {
      return _offline.calculateRoute(origin: origin, destination: destination, profile: profile);
    }
    try {
      return await _online.calculateRoute(
        origin: origin,
        destination: destination,
        profile: profile,
        alternatives: alternatives,
      );
    } on AppException catch (serverError) {
      if (!_canFallBack(serverError)) rethrow;
      try {
        return await _offline.calculateRoute(
          origin: origin,
          destination: destination,
          profile: profile,
        );
      } on AppException catch (offlineError) {
        // Nothing stored either: explain the server problem when there is
        // connection (engine down), or the offline limitation when there is not.
        if (offlineError.code == ErrorCodes.offlineRouteUnavailable &&
            !serverError.isNetworkError) {
          throw serverError;
        }
        rethrow;
      }
    }
  }

  static bool _canFallBack(AppException error) =>
      error.isNetworkError ||
      error.code == ErrorCodes.routingProviderUnavailable ||
      (error.statusCode != null && error.statusCode! >= 500);
}
