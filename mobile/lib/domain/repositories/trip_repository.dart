import '../entities/routing_profile.dart';
import '../entities/trip.dart';

/// Trips and their GPS points, stored locally first.
abstract class TripRepository {
  Stream<List<Trip>> watchTrips({int limit = 50});

  Future<Trip?> activeTrip();

  /// Creates an active trip and queues `trip:CREATE`.
  Future<Trip> startTrip({
    required RoutingProfile profile,
    String? name,
    String? routeId,
    required String installationId,
  });

  /// Stores a fix (duplicates for the same instant are ignored).
  Future<void> addPoint(TrackingPoint point);

  /// Moves points not yet queued into `tracking_point:CREATE` operations.
  /// Returns how many points were queued.
  Future<int> queuePendingPoints({int batchSize = 500});

  /// Queues the remaining points, then `trip:FINISH`, and completes the trip.
  Future<Trip> finishTrip(String tripId);

  /// Queues `trip:CANCEL` and marks the trip cancelled.
  Future<Trip> cancelTrip(String tripId);
}
