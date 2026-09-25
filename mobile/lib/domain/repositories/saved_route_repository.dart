import '../entities/offline_route.dart';
import '../entities/route.dart';
import '../entities/routing_profile.dart';

/// Routes stored on the device (Drift). Changes are queued for synchronization.
abstract class SavedRouteRepository {
  Stream<List<OfflineRoute>> watchAll();

  Future<List<OfflineRoute>> getAll();

  Future<OfflineRoute?> getById(String routeId);

  /// Stores [option] of [result] under [name] and queues it for the server.
  Future<OfflineRoute> save({
    required RouteResult result,
    required RouteOption option,
    required String name,
    String? regionId,
  });

  Future<void> delete(String routeId);

  /// Stored routes of [profile], candidates for offline routing.
  Future<List<OfflineRoute>> byProfile(RoutingProfile profile);

  /// Applies routes pulled from the server (no sync operation is queued).
  Future<void> applyRemote({required List<OfflineRoute> routes, required List<String> deletedIds});
}
