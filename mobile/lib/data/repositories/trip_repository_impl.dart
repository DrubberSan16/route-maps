import 'package:drift/drift.dart';
import 'package:uuid/uuid.dart';

import '../../core/utils/time.dart';
import '../../domain/entities/coordinate.dart';
import '../../domain/entities/routing_profile.dart';
import '../../domain/entities/sync.dart';
import '../../domain/entities/trip.dart';
import '../../domain/geo.dart';
import '../../domain/repositories/trip_repository.dart';
import '../local/app_database.dart';
import '../local/current_account.dart';
import '../local/sync_queue_store.dart';

/// Trips of the current account (see [AppDatabase]). The trip being recorded
/// is the device's: its points and its end are queued for the account that
/// started it, whoever is logged in when they happen.
class TripRepositoryImpl implements TripRepository {
  TripRepositoryImpl({
    required this._db,
    required this._queue,
    required this._account,
    this._uuid = const Uuid(),
    DateTime Function()? clock,
  }) : _clock = clock ?? DateTime.now;

  final AppDatabase _db;
  final SyncQueueStore _queue;
  final CurrentAccount _account;
  final Uuid _uuid;
  final DateTime Function() _clock;

  @override
  Stream<List<Trip>> watchTrips({int limit = 50}) {
    final account = _account();
    final query = _db.select(_db.trips)
      ..where((t) => account == null ? t.accountId.isNull() : t.accountId.equals(account))
      ..orderBy([(t) => OrderingTerm.desc(t.startedAt)])
      ..limit(limit);
    return query.watch().map((rows) => rows.map(_toTrip).toList());
  }

  @override
  Future<Trip?> activeTrip() async {
    final row =
        await (_db.select(_db.trips)
              ..where((t) => t.status.equals(TripStatus.active.value))
              ..orderBy([(t) => OrderingTerm.desc(t.startedAt)])
              ..limit(1))
            .getSingleOrNull();
    return row == null ? null : _toTrip(row);
  }

  @override
  Future<Trip> startTrip({
    required RoutingProfile profile,
    String? name,
    String? routeId,
    required String installationId,
  }) async {
    final trip = Trip(
      id: _uuid.v4(),
      name: name,
      profile: profile,
      routeId: routeId,
      status: TripStatus.active,
      startedAt: utcMillis(_clock()),
    );
    final account = _account();
    await _db.transaction(() async {
      await _db
          .into(_db.trips)
          .insert(
            TripsCompanion.insert(
              id: trip.id,
              name: Value(name),
              profile: profile.apiValue,
              routeId: Value(routeId),
              status: trip.status.value,
              startedAt: trip.startedAt,
              accountId: Value(account),
            ),
          );
      await _queue.add(
        accountId: account,
        entity: SyncEntities.trip,
        operation: SyncOperations.create,
        payload: {
          'id': trip.id,
          'name': ?name,
          'profile': profile.apiValue,
          'routeId': ?routeId,
          'installationId': installationId,
          'startedAt': isoUtc(trip.startedAt),
        },
      );
    });
    return trip;
  }

  @override
  Future<void> addPoint(TrackingPoint point) => _db.transaction(() async {
    final trip = await _findTrip(point.tripId);
    if (trip == null || trip.status != TripStatus.active.value) return;
    final previous =
        await (_db.select(_db.trackingPoints)
              ..where((t) => t.tripId.equals(point.tripId))
              ..orderBy([(t) => OrderingTerm.desc(t.recordedAt)])
              ..limit(1))
            .getSingleOrNull();
    final inserted = await _db
        .into(_db.trackingPoints)
        .insertReturningOrNull(
          TrackingPointsCompanion.insert(
            tripId: point.tripId,
            latitude: point.coordinate.latitude,
            longitude: point.coordinate.longitude,
            accuracy: Value(point.accuracy),
            speed: Value(point.speed),
            heading: Value(point.heading),
            altitude: Value(point.altitude),
            recordedAt: utcMillis(point.recordedAt),
          ),
          mode: InsertMode.insertOrIgnore,
        );
    // Null when a fix for the same (trip, instant) was already stored.
    if (inserted == null) return;
    final step = previous == null
        ? 0.0
        : distanceMeters(Coordinate(previous.latitude, previous.longitude), point.coordinate);
    await (_db.update(_db.trips)..where((t) => t.id.equals(point.tripId))).write(
      TripsCompanion.custom(
        distanceMeters: _db.trips.distanceMeters + Variable(step),
        pointCount: _db.trips.pointCount + const Variable(1),
      ),
    );
  });

  @override
  Future<int> queuePendingPoints({int batchSize = 500}) =>
      _db.transaction(() => _queuePoints(batchSize: batchSize));

  @override
  Future<Trip> finishTrip(String tripId) => _close(tripId, TripStatus.completed);

  @override
  Future<Trip> cancelTrip(String tripId) => _close(tripId, TripStatus.cancelled);

  /// Points go first so the server accepts them while the trip is still active.
  Future<Trip> _close(String tripId, TripStatus status) => _db.transaction(() async {
    final row = await _findTrip(tripId);
    if (row == null) throw StateError('Trip $tripId does not exist');
    if (row.status != TripStatus.active.value) return _toTrip(row);
    await _queuePoints(tripId: tripId, batchSize: 500);
    final endedAt = utcMillis(_clock());
    await (_db.update(_db.trips)..where((t) => t.id.equals(tripId))).write(
      TripsCompanion(status: Value(status.value), endedAt: Value(endedAt)),
    );
    await _queue.add(
      accountId: row.accountId,
      entity: SyncEntities.trip,
      operation: status == TripStatus.completed ? SyncOperations.finish : SyncOperations.cancel,
      payload: {'id': tripId, if (status == TripStatus.completed) 'endedAt': isoUtc(endedAt)},
    );
    return _toTrip((await _findTrip(tripId))!);
  });

  Future<int> _queuePoints({String? tripId, required int batchSize}) async {
    final query = _db.select(_db.trackingPoints)
      ..where((t) => t.queued.equals(false))
      ..orderBy([(t) => OrderingTerm.asc(t.id)]);
    if (tripId != null) query.where((t) => t.tripId.equals(tripId));
    final rows = await query.get();
    if (rows.isEmpty) return 0;

    final byTrip = <String, List<TrackingPointRow>>{};
    for (final row in rows) {
      byTrip.putIfAbsent(row.tripId, () => []).add(row);
    }
    final owners = {
      for (final trip in await (_db.select(_db.trips)..where((t) => t.id.isIn(byTrip.keys))).get())
        trip.id: trip.accountId,
    };
    for (final MapEntry(key: trip, value: points) in byTrip.entries) {
      for (var start = 0; start < points.length; start += batchSize) {
        final chunk = points.sublist(start, (start + batchSize).clamp(0, points.length));
        await _queue.add(
          accountId: owners[trip],
          entity: SyncEntities.trackingPoint,
          operation: SyncOperations.create,
          payload: {
            'points': [for (final row in chunk) _toPoint(row).toPayload()],
          },
        );
      }
    }
    await (_db.update(_db.trackingPoints)..where((t) => t.id.isIn(rows.map((row) => row.id))))
        .write(const TrackingPointsCompanion(queued: Value(true)));
    return rows.length;
  }

  Future<TripRow?> _findTrip(String id) =>
      (_db.select(_db.trips)..where((t) => t.id.equals(id))).getSingleOrNull();

  static TrackingPoint _toPoint(TrackingPointRow row) => TrackingPoint(
    tripId: row.tripId,
    coordinate: Coordinate(row.latitude, row.longitude),
    recordedAt: row.recordedAt,
    accuracy: row.accuracy,
    speed: row.speed,
    heading: row.heading,
    altitude: row.altitude,
  );

  static Trip _toTrip(TripRow row) => Trip(
    id: row.id,
    name: row.name,
    profile: RoutingProfile.fromApi(row.profile),
    routeId: row.routeId,
    status: TripStatus.fromValue(row.status),
    startedAt: row.startedAt,
    endedAt: row.endedAt,
    distanceMeters: row.distanceMeters,
    pointCount: row.pointCount,
  );
}
