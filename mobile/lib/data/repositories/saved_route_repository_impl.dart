import 'dart:convert';

import 'package:drift/drift.dart';
import 'package:uuid/uuid.dart';

import '../../core/utils/time.dart';
import '../../domain/entities/coordinate.dart';
import '../../domain/entities/offline_route.dart';
import '../../domain/entities/route.dart';
import '../../domain/entities/routing_profile.dart';
import '../../domain/entities/sync.dart';
import '../../domain/repositories/saved_route_repository.dart';
import '../local/app_database.dart';
import '../local/sync_queue_store.dart';

class SavedRouteRepositoryImpl implements SavedRouteRepository {
  SavedRouteRepositoryImpl({
    required this._db,
    required this._queue,
    this._uuid = const Uuid(),
    DateTime Function()? clock,
  }) : _clock = clock ?? DateTime.now;

  final AppDatabase _db;
  final SyncQueueStore _queue;
  final Uuid _uuid;
  final DateTime Function() _clock;

  @override
  Stream<List<OfflineRoute>> watchAll() =>
      _allQuery().watch().map((rows) => rows.map(_toRoute).toList());

  @override
  Future<List<OfflineRoute>> getAll() async => (await _allQuery().get()).map(_toRoute).toList();

  @override
  Future<OfflineRoute?> getById(String routeId) async {
    final row = await (_db.select(
      _db.offlineRoutes,
    )..where((t) => t.routeId.equals(routeId))).getSingleOrNull();
    return row == null ? null : _toRoute(row);
  }

  @override
  Future<OfflineRoute> save({
    required RouteResult result,
    required RouteOption option,
    required String name,
    String? regionId,
  }) async {
    final now = utcMillis(_clock());
    final route = OfflineRoute(
      routeId: _uuid.v4(),
      name: name.trim(),
      profile: result.profile,
      origin: result.origin,
      destination: result.destination,
      distanceMeters: option.distanceMeters,
      durationSeconds: option.durationSeconds,
      geometry: option.geometry,
      steps: option.steps,
      regionId: regionId,
      provider: result.provider,
      createdAt: now,
      updatedAt: now,
    );
    await _db.transaction(() async {
      await _db.into(_db.offlineRoutes).insert(_toRow(route));
      await _queue.add(
        entity: SyncEntities.route,
        operation: SyncOperations.upsert,
        payload: route.toSyncPayload(),
      );
    });
    return route;
  }

  @override
  Future<void> delete(String routeId) => _db.transaction(() async {
    final deleted = await (_db.delete(
      _db.offlineRoutes,
    )..where((t) => t.routeId.equals(routeId))).go();
    if (deleted > 0) {
      await _queue.add(
        entity: SyncEntities.route,
        operation: SyncOperations.delete,
        payload: {'id': routeId},
      );
    }
  });

  @override
  Future<List<OfflineRoute>> byProfile(RoutingProfile profile) async {
    final rows = await (_db.select(
      _db.offlineRoutes,
    )..where((t) => t.profile.equals(profile.apiValue))).get();
    return rows.map(_toRoute).toList();
  }

  @override
  Future<void> applyRemote({
    required List<OfflineRoute> routes,
    required List<String> deletedIds,
  }) => _db.transaction(() async {
    for (final route in routes) {
      // A delete made on this device and not sent yet wins over the server copy.
      if (await _queue.hasUnsentRouteDelete(route.routeId)) continue;
      await _db.into(_db.offlineRoutes).insertOnConflictUpdate(_toRow(route));
    }
    if (deletedIds.isNotEmpty) {
      await (_db.delete(_db.offlineRoutes)..where((t) => t.routeId.isIn(deletedIds))).go();
    }
  });

  SimpleSelectStatement<$OfflineRoutesTable, OfflineRouteRow> _allQuery() =>
      _db.select(_db.offlineRoutes)..orderBy([(t) => OrderingTerm.desc(t.updatedAt)]);

  OfflineRoutesCompanion _toRow(OfflineRoute route) => OfflineRoutesCompanion.insert(
    routeId: route.routeId,
    name: route.name,
    profile: route.profile.apiValue,
    originLatitude: route.origin.latitude,
    originLongitude: route.origin.longitude,
    destinationLatitude: route.destination.latitude,
    destinationLongitude: route.destination.longitude,
    distanceMeters: route.distanceMeters,
    durationSeconds: route.durationSeconds,
    geometry: jsonEncode([for (final point in route.geometry) point.toLngLat()]),
    steps: jsonEncode([for (final step in route.steps) step.toJson()]),
    regionId: Value(route.regionId),
    provider: Value(route.provider),
    createdAt: utcMillis(route.createdAt),
    updatedAt: utcMillis(route.updatedAt),
  );

  static OfflineRoute _toRoute(OfflineRouteRow row) => OfflineRoute(
    routeId: row.routeId,
    name: row.name,
    profile: RoutingProfile.fromApi(row.profile),
    origin: Coordinate(row.originLatitude, row.originLongitude),
    destination: Coordinate(row.destinationLatitude, row.destinationLongitude),
    distanceMeters: row.distanceMeters,
    durationSeconds: row.durationSeconds,
    geometry: [
      for (final position in jsonDecode(row.geometry) as List<Object?>)
        Coordinate.fromLngLat(position! as List<Object?>),
    ],
    steps: [
      for (final step in jsonDecode(row.steps) as List<Object?>)
        RouteStep.fromJson(step! as Map<String, Object?>),
    ],
    regionId: row.regionId,
    provider: row.provider,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  );
}
