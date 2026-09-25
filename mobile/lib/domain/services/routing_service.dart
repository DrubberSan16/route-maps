import '../entities/coordinate.dart';
import '../entities/route.dart';
import '../entities/routing_profile.dart';

/// Calculates routes. Implementations: online (our API), offline (stored
/// routes and on-device engines) and the one that chooses between them.
abstract class RoutingService {
  Future<RouteResult> calculateRoute({
    required Coordinate origin,
    required Coordinate destination,
    required RoutingProfile profile,
    bool alternatives = true,
  });
}
