import 'package:drift/drift.dart';
import 'package:drift_flutter/drift_flutter.dart';
import 'package:path_provider/path_provider.dart';

import '../../domain/entities/sync.dart';
import 'tables.dart';

export 'tables.dart';

part 'app_database.g.dart';

/// Local SQLite database (Drift). Everything the app needs offline lives here:
/// the region catalog, downloaded regions, saved routes, trips with their GPS
/// points and the `sync_queue` of changes waiting for the server.
///
/// Saved routes, trips and queued operations belong to an account (the user
/// id, or null when created without one). Several people may use the same
/// phone: each account only sees and synchronizes its own data, and the data
/// of an account that logged out stays on the device for when it comes back.
@DriftDatabase(
  tables: [
    CatalogRegions,
    DownloadedRegions,
    RegionDownloads,
    OfflineRoutes,
    SyncQueue,
    Trips,
    TrackingPoints,
    KeyValues,
  ],
)
class AppDatabase extends _$AppDatabase {
  AppDatabase(super.executor);

  /// Database file in the application support directory.
  factory AppDatabase.open() => AppDatabase(
    driftDatabase(
      name: 'maps_platform',
      native: const DriftNativeOptions(databaseDirectory: getApplicationSupportDirectory),
    ),
  );

  @override
  int get schemaVersion => 2;

  @override
  MigrationStrategy get migration => MigrationStrategy(
    onCreate: (migrator) => migrator.createAll(),
    onUpgrade: (migrator, from, to) async {
      if (from < 2) {
        // Existing rows stay without an account; the session restored at
        // start-up adopts them (see [adoptGuestData]).
        await migrator.addColumn(offlineRoutes, offlineRoutes.accountId);
        await migrator.addColumn(trips, trips.accountId);
        await migrator.addColumn(syncQueue, syncQueue.accountId);
      }
    },
    beforeOpen: (details) async {
      await customStatement('PRAGMA foreign_keys = ON');
    },
  );

  /// Gives the saved routes, trips and queued operations created without an
  /// account to [accountId], the account that is logging in on this device.
  Future<void> adoptGuestData(String accountId) => transaction(() async {
    await (update(offlineRoutes)..where((t) => t.accountId.isNull())).write(
      OfflineRoutesCompanion(accountId: Value(accountId)),
    );
    await (update(
      trips,
    )..where((t) => t.accountId.isNull())).write(TripsCompanion(accountId: Value(accountId)));
    await (update(
      syncQueue,
    )..where((t) => t.accountId.isNull())).write(SyncQueueCompanion(accountId: Value(accountId)));
  });

  Future<String?> readValue(String key) async {
    final row = await (select(
      keyValues,
    )..where((table) => table.key.equals(key))).getSingleOrNull();
    return row?.value;
  }

  Future<void> writeValue(String key, String value) =>
      into(keyValues).insertOnConflictUpdate(KeyValuesCompanion.insert(key: key, value: value));

  Future<void> deleteValue(String key) =>
      (delete(keyValues)..where((table) => table.key.equals(key))).go();
}
